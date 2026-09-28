/**
 * End-to-end smoke test in a real (headless) browser at phone size.
 * Drives the actual UI: play → win → NEXT → fail → revive → retry → upgrade.
 * Usage: npm run build && npm run e2e
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'child_process';

const PORT = 4179;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let failed = false;
const check = (cond, msg) => {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failed = true;
};

try {
  const ctx = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const game = (fn) => page.evaluate(fn);
  const waitFor = async (fn, timeout = 90000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await page.evaluate(fn)) return true;
      await page.waitForTimeout(200);
    }
    return false;
  };

  await page.goto(`http://localhost:${PORT}/?debug&autoplay=0.95`);
  await page.waitForTimeout(700);
  check(await game(() => window.__game.state === 'home'), 'boots to home screen');
  await page.mouse.click(195, 330);
  check(await game(() => window.__game.state === 'playing'), 'one tap starts gameplay');
  check(await waitFor(() => window.__game.state === 'result'), 'level 1 reaches a result');
  check(await game(() => window.__game.sim.phase === 'won'), 'level 1 is won by a competent player');
  const coins = await game(() => window.__game.save.data.coins);
  check(coins > 0, `coins awarded (${coins})`);
  await page.waitForTimeout(500);
  const t0 = Date.now();
  await page.click('[data-action="next"]', { force: true });
  check(await waitFor(() => window.__game.state === 'playing', 3000), `NEXT starts level 2 immediately (${Date.now() - t0}ms)`);
  check(await game(() => window.__game.sim.plan.level === 2), 'level 2 loaded');

  // Force a failure to test the fail → revive → retry loop.
  await game(() => {
    const g = window.__game;
    g.autoplay = null;
    for (let i = 0; i < g.sim.units.count; i++) g.sim.units.kill(g.sim.units.units[i]);
    g.sim.units.compact();
  });
  check(await waitFor(() => window.__game.state === 'result', 5000), 'failure shows result screen');
  check((await page.textContent('.result-title'))?.includes('YOU LOST'), '"YOU LOST" shown');
  check(!!(await page.$('[data-action="retry"]')), 'TAP TO RETRY present');
  await page.waitForTimeout(400);
  const retryAt = Date.now();
  await page.click('[data-action="retry"]', { force: true });
  check(await waitFor(() => window.__game.state === 'playing', 3000), `retry is instant (${Date.now() - retryAt}ms)`);

  // Upgrade flow
  await game(() => {
    const g = window.__game;
    g.currency.earn('coins', 5000);
    g.pause();
  });
  await page.click('[data-action="home"]');
  check(await waitFor(() => window.__game.state === 'home', 2000), 'home from pause');
  const before = await game(() => window.__game.save.data.upgrades.power);
  await page.click('[data-action="upgrade"][data-arg="power"]');
  const after = await game(() => window.__game.save.data.upgrades.power);
  check(after === before + 1, 'upgrade purchase applies');

  // Modals
  for (const a of ['skins', 'daily', 'trophies', 'shop', 'settings']) {
    await page.click(`[data-action="${a}"]`, { force: true });
    check(!!(await page.$('.modal')), `${a} screen opens`);
    await page.click('[data-action="close"]', { force: true });
  }

  // Persistence across reload
  await page.reload();
  await page.waitForTimeout(700);
  check((await game(() => window.__game.save.data.upgrades.power)) === after, 'progress persists across app restart');
  check(errors.length === 0, `no runtime errors ${errors.length ? JSON.stringify(errors) : ''}`);
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
