import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const viewports = [
  { width: 1144, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, reducedMotion: viewport.width === 1280 ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    let runtimeReady = false;
    await page.route('**/*', async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/api/')) {
        await route.continue();
        return;
      }
      if (pathname === '/api/hermes-runtime/status') {
        const ready = runtimeReady;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            autoStart: {
              status: ready ? 'partial' : 'starting',
              startedAt: new Date().toISOString(),
              finishedAt: ready ? new Date().toISOString() : null,
              steps: [
                { id: 'profiles', label: '读取本地 Hermes Profiles', status: 'ready', detail: '7 profiles' },
                { id: 'api', label: '启动 Frakio Work Runtime API', status: ready ? 'failed' : 'running', detail: ready ? 'stderr: Runtime API did not become ready\nfull command must not leak into the loading page' : 'http://127.0.0.1:8643/v1' },
              ],
            },
          }),
        });
        return;
      }
      if (pathname === '/api/agents') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'iris', name: 'Iris', role: 'Coordinator', model: '', color: '#0f766e', soul: '', scope: '' }] }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const working = page.locator('[data-launch-panel="working"]');
    await working.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.locator('[data-launch-panel]').count(), 1, `${viewport.width}: working phase rendered overlapping panels`);
    const workingBox = await working.boundingBox();
    assert.ok(workingBox && workingBox.x >= 0 && workingBox.x + workingBox.width <= viewport.width, `${viewport.width}: working panel overflowed`);
    runtimeReady = true;
    await page.locator('[data-launch-panel="welcome"]').waitFor({ state: 'visible', timeout: 12000 });
    assert.equal(await page.locator('[data-launch-panel]').count(), 1, `${viewport.width}: welcome phase rendered overlapping panels`);
    const welcome = page.locator('.launch-welcome');
    const welcomeBox = await welcome.boundingBox();
    assert.ok(welcomeBox && welcomeBox.x >= 0 && welcomeBox.y >= 0 && welcomeBox.x + welcomeBox.width <= viewport.width && welcomeBox.y + welcomeBox.height <= viewport.height, `${viewport.width}: welcome content was clipped`);
    const welcomeMetrics = await welcome.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    assert.equal(welcomeMetrics.scrollWidth <= welcomeMetrics.clientWidth + 1 && welcomeMetrics.scrollHeight <= welcomeMetrics.clientHeight + 1, true, `${viewport.width}: welcome content overflowed its box ${JSON.stringify(welcomeMetrics)}`);
    await context.close();
  }
  console.log('Launch loading visual-state checks passed.');
} finally {
  await browser.close();
}
