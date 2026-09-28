/**
 * Builds a single self-contained HTML page (JS + CSS inlined) for sharing the
 * game as a web link. Output: dist-single/swarm-surge.html
 */
import { build } from 'vite';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const out = 'dist-single/tmp';
await build({ logLevel: 'warn', build: { outDir: out, emptyOutDir: true, rollupOptions: { output: { inlineDynamicImports: true } } } });
const assets = join(out, 'assets');
const files = readdirSync(assets);
const js = readFileSync(join(assets, files.find((f) => f.endsWith('.js'))), 'utf8').replace(/<\/script/g, '<\\/script');
const css = readFileSync(join(assets, files.find((f) => f.endsWith('.css'))), 'utf8');
const html = `<title>Swarm Surge</title>
<meta name="theme-color" content="#2a1760">
<style>:root{color-scheme:dark;padding:0!important}body{background:#2a1760}${css}</style>
<div id="app">
  <canvas id="game"></canvas>
  <button id="pauseBtn" aria-label="Pause">❚❚</button>
  <div id="ui"></div>
  <div id="toasts"></div>
</div>
<script type="module">${js}</script>
`;
mkdirSync('dist-single', { recursive: true });
writeFileSync('dist-single/swarm-surge.html', html);
console.log('wrote dist-single/swarm-surge.html', (html.length / 1024).toFixed(0) + ' KB');
