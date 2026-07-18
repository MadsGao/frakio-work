import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.FRAKIO_E2E_BROWSER || '';
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const closeGuide = page.getByRole('button', { name: /(稍后处理|进入工作台)/ });
  await closeGuide.waitFor({ state: 'visible', timeout: 45000 }).catch(() => null);
  if (await closeGuide.count()) await closeGuide.click();
  await page.waitForTimeout(1500);
  const decline = page.getByRole('button', { name: '不发送' });
  assert.equal(await decline.count(), 1, '首次启动应显示遥测同意选择');
  await decline.click();
  await page.waitForTimeout(800);
  assert.equal(await page.getByText('我们接下来做点什么？').count() > 0, true, '工作台主界面未显示');
  await mkdir('output/playwright', { recursive: true });
  if (process.env.FRAKIO_UPDATE_README_SCREENSHOT === '1') {
    await mkdir('docs/assets', { recursive: true });
    await page.screenshot({ path: 'docs/assets/frakio-work.png', fullPage: true });
  }
  await page.screenshot({ path: 'output/playwright/frakio-release-workbench.png', fullPage: true });
  await page.getByRole('button', { name: '打开用户菜单' }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.waitForTimeout(1000);
  const updatesHeading = page.getByRole('heading', { name: '版本与更新' });
  await updatesHeading.scrollIntoViewIfNeeded();
  assert.equal(await updatesHeading.isVisible(), true, '设置页未显示版本更新区域');
  await page.screenshot({ path: 'output/playwright/frakio-release-updates.png', fullPage: true });
  const relevantErrors = errors.filter((value) => !value.includes('favicon'));
  assert.deepEqual(relevantErrors, [], `Browser console errors: ${relevantErrors.join(' | ')}`);
  console.log('Playwright release flow passed.');
} finally {
  await browser.close();
}
