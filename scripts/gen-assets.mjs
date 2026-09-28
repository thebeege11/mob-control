/**
 * Generates app icons & splash screens for iOS/Android from resources/*.svg
 * using headless Chromium (Playwright). Run: node scripts/gen-assets.mjs
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const root = new URL('..', import.meta.url).pathname;
const svg = readFileSync(join(root, 'resources/icon.svg'), 'utf8');
const fg = readFileSync(join(root, 'resources/icon-foreground.svg'), 'utf8');
const splash = readFileSync(join(root, 'resources/splash.html'), 'utf8');

function pngSize(file) {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const browser = await pw.chromium.launch();
const page = await browser.newPage();
async function renderSvg(src, size, out, round = false, bg = 'transparent') {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${size}px;height:${size}px;${round ? 'border-radius:50%;overflow:hidden;' : ''}">${src.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`);
  await page.screenshot({ path: out, omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: size, height: size } });
}
async function renderHtml(html, w, h, out) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.screenshot({ path: out });
}

// Android launcher icons
const res = join(root, 'android/app/src/main/res');
if (existsSync(res)) {
  for (const dir of readdirSync(res)) {
    const d = join(res, dir);
    if (dir.startsWith('mipmap-') && !dir.includes('anydpi')) {
      for (const f of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
        const p = join(d, f);
        if (!existsSync(p)) continue;
        const [w] = pngSize(p);
        if (f === 'ic_launcher_foreground.png') await renderSvg(fg, w, p);
        else await renderSvg(svg, w, p, f.includes('round'));
      }
    }
    if (dir.startsWith('drawable')) {
      const p = join(d, 'splash.png');
      if (existsSync(p)) {
        const [w, h] = pngSize(p);
        await renderHtml(splash, w, h, p);
      }
    }
  }
  writeFileSync(join(res, 'values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2A1760</color>\n</resources>\n');
}

// iOS app icon (single 1024 universal) and splash
const ios = join(root, 'ios/App/App/Assets.xcassets');
if (existsSync(ios)) {
  await renderSvg(svg.replace('rx="110"', 'rx="0"'), 1024, join(ios, 'AppIcon.appiconset/AppIcon-512@2x.png'), false, '#2a1760');
  const sp = join(ios, 'Splash.imageset');
  if (existsSync(sp)) for (const f of readdirSync(sp).filter((f) => f.endsWith('.png'))) {
    const [w, h] = pngSize(join(sp, f));
    await renderHtml(splash, w, h, join(sp, f));
  }
}
// Store listing icon
await renderSvg(svg.replace('rx="110"', 'rx="0"'), 512, join(root, 'resources/store-icon-512.png'), false, '#2a1760');
await browser.close();
console.log('assets generated');
