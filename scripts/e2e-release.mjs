import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.FRAKIO_E2E_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.FRAKIO_E2E_BROWSER || '';
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
let weixinStatusChecks = 0;
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/hermes/weixin/qrcode/status?*', async (route) => {
  weixinStatusChecks += 1;
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'wait' }) });
});
await page.route('**/api/hermes/weixin/qrcode', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ qrcode: 'frakio-e2e-weixin', qrcode_url: 'https://weixin.qq.com/x/frakio-e2e-weixin' }),
  });
});

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const closeGuide = page.getByRole('button', { name: /(稍后处理|进入工作台)/ });
  await closeGuide.waitFor({ state: 'visible', timeout: 45000 }).catch(() => null);
  if (await closeGuide.count()) await closeGuide.click();
  await page.waitForTimeout(1500);
  const decline = page.getByRole('button', { name: '不发送' });
  if (await decline.count()) {
    await decline.click();
    await page.waitForTimeout(800);
  }
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
  await page.getByRole('button', { name: '频道', exact: true }).click();
  await page.getByRole('heading', { name: '频道', exact: true }).waitFor({ state: 'visible' });
  const weixinCard = page.locator('.platform-card').filter({ hasText: 'Weixin' });
  await weixinCard.getByRole('button', { name: '扫码登录', exact: true }).click();
  const weixinDialog = page.getByRole('dialog', { name: '微信扫码登录' });
  await weixinDialog.waitFor({ state: 'visible' });
  assert.equal(await weixinDialog.locator('.weixin-qr-code svg').count(), 1, '微信登录弹窗未显示内嵌二维码');
  assert.equal(await weixinDialog.getByText('请使用微信扫码登录。').isVisible(), true, '微信登录弹窗未显示等待状态');
  await page.screenshot({ path: 'output/playwright/frakio-release-weixin-qr.png', fullPage: true });
  await weixinDialog.getByRole('button', { name: '关闭' }).click();
  await weixinDialog.waitFor({ state: 'hidden' });
  const checksAfterClose = weixinStatusChecks;
  await page.waitForTimeout(3500);
  assert.equal(weixinStatusChecks, checksAfterClose, '关闭微信登录弹窗后仍在轮询旧二维码');
  const relevantErrors = errors.filter((value) => !value.includes('favicon'));
  assert.deepEqual(relevantErrors, [], `Browser console errors: ${relevantErrors.join(' | ')}`);
  console.log('Playwright release flow passed.');
} finally {
  await browser.close();
}
