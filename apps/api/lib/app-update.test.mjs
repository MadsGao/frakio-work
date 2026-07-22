import assert from 'node:assert/strict';
import test from 'node:test';
import { appUpdateStatus, compareVersions, resetAppUpdateCache, selectReleaseAsset } from './app-update.mjs';

test('semantic versions compare numerically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0);
});

test('release asset selection matches desktop platform and architecture', () => {
  const assets = [
    { name: 'Frakio.Work-0.2.0-x64.dmg' },
    { name: 'Frakio.Work-0.2.0-arm64.dmg' },
    { name: 'Frakio.Work-0.2.0-x64.exe' },
  ];
  assert.equal(selectReleaseAsset(assets, { platform: 'darwin', arch: 'arm64' })?.name, assets[1].name);
  assert.equal(selectReleaseAsset(assets, { platform: 'darwin', arch: 'x64' })?.name, assets[0].name);
  assert.equal(selectReleaseAsset(assets, { platform: 'win32', arch: 'x64' })?.name, assets[2].name);
  assert.equal(selectReleaseAsset(assets, { platform: 'win32', arch: 'arm64' }), null);
});

test('update status maps a GitHub release without network access', async () => {
  resetAppUpdateCache();
  const status = await appUpdateStatus({
    currentVersion: '0.1.0',
    packaged: true,
    platform: 'darwin',
    arch: 'arm64',
    fetchImpl: async () => ({ ok: true, json: async () => [{ tag_name: 'v0.2.0', prerelease: true, html_url: 'https://github.com/MadsGao/frakio-work/releases/tag/v0.2.0', assets: [{ name: 'Frakio Work-0.2.0-arm64.dmg', browser_download_url: 'https://github.com/MadsGao/frakio-work/releases/download/v0.2.0/app.dmg' }] }] }),
  });
  assert.equal(status.updateAvailable, true);
  assert.equal(status.asset.name, 'Frakio Work-0.2.0-arm64.dmg');
});

test('update status falls back to the public releases feed when API rate limited', async () => {
  const feed = `<?xml version="1.0"?><feed><entry><updated>2026-07-18T11:44:53Z</updated><link rel="alternate" type="text/html" href="https://github.com/MadsGao/frakio-work/releases/tag/v0.2.0"/><content type="html">Beta notes</content></entry></feed>`;
  const status = await appUpdateStatus({
    currentVersion: '0.1.0',
    force: true,
    packaged: true,
    platform: 'darwin',
    arch: 'x64',
    fetchImpl: async (url) => String(url).endsWith('.atom')
      ? { ok: true, text: async () => feed }
      : { ok: false, status: 403 },
  });
  assert.equal(status.latestVersion, '0.2.0');
  assert.equal(status.updateAvailable, true);
  assert.match(status.asset.browser_download_url, /x64\.dmg$/);
});

test('release feed fallback exposes the Windows x64 installer', async () => {
  resetAppUpdateCache();
  const feed = `<?xml version="1.0"?><feed><entry><updated>2026-07-22T11:00:00Z</updated><link rel="alternate" type="text/html" href="https://github.com/MadsGao/frakio-work/releases/tag/v0.2.0"/><content type="html">Beta notes</content></entry></feed>`;
  const status = await appUpdateStatus({
    currentVersion: '0.1.0',
    force: true,
    packaged: true,
    platform: 'win32',
    arch: 'x64',
    fetchImpl: async (url) => String(url).endsWith('.atom')
      ? { ok: true, text: async () => feed }
      : { ok: false, status: 403 },
  });
  assert.match(status.asset.browser_download_url, /x64\.exe$/);
});
