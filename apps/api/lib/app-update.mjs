const repository = 'MadsGao/frakio-work';
const repositoryUrl = `https://github.com/${repository}`;
const releasesApiUrl = `https://api.github.com/repos/${repository}/releases?per_page=10`;
const releasesFeedUrl = `${repositoryUrl}/releases.atom`;
const cacheTtlMs = 15 * 60 * 1000;

let cache = { checkedAt: 0, release: null };

export function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function selectReleaseAsset(assets = [], { platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'darwin') return null;
  const architecture = arch === 'arm64' ? 'arm64' : 'x64';
  const candidates = assets.filter((asset) => String(asset?.name || '').toLowerCase().endsWith('.dmg'));
  return candidates.find((asset) => String(asset.name).toLowerCase().includes(`-${architecture}.dmg`))
    || candidates.find((asset) => String(asset.name).toLowerCase().includes(architecture))
    || null;
}

function decodeFeedText(value = '') {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchLatestReleaseFromFeed(fetchImpl) {
  const response = await fetchImpl(releasesFeedUrl, {
    headers: { Accept: 'application/atom+xml', 'User-Agent': 'Frakio-Work' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub Releases feed failed with HTTP ${response.status}.`);
  const xml = await response.text();
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1] || '';
  const htmlUrl = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/)?.[1] || '';
  const tag = htmlUrl.match(/\/tag\/([^/?#]+)/)?.[1] || '';
  if (!tag) throw new Error('GitHub does not have a published Frakio Work release yet.');
  const version = tag.replace(/^v/i, '');
  const assetName = (arch) => `Frakio.Work-${version}-${arch}.dmg`;
  return {
    tag_name: tag,
    html_url: htmlUrl,
    body: decodeFeedText(entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] || ''),
    published_at: entry.match(/<updated>([^<]+)<\/updated>/)?.[1] || '',
    assets: ['arm64', 'x64'].map((arch) => ({
      name: assetName(arch),
      browser_download_url: `${repositoryUrl}/releases/download/${tag}/${assetName(arch)}`,
    })),
  };
}

async function fetchLatestRelease({ force = false, fetchImpl = fetch } = {}) {
  if (!force && cache.release && Date.now() - cache.checkedAt < cacheTtlMs) return cache.release;
  const response = await fetchImpl(releasesApiUrl, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Frakio-Work' },
    signal: AbortSignal.timeout(15000),
  });
  let release = null;
  if (response.ok) {
    const payload = await response.json();
    release = (Array.isArray(payload) ? payload : [payload]).find((item) => item && !item.draft);
  } else {
    release = await fetchLatestReleaseFromFeed(fetchImpl);
  }
  if (!release) throw new Error('GitHub does not have a published Frakio Work release yet.');
  cache = { checkedAt: Date.now(), release };
  return release;
}

export async function appUpdateStatus({ currentVersion, force = false, packaged = false, platform = process.platform, arch = process.arch, fetchImpl = fetch } = {}) {
  const base = {
    currentVersion: String(currentVersion || '0.0.0'),
    latestVersion: '',
    updateAvailable: false,
    channel: 'beta',
    repositoryUrl,
    releaseUrl: `${repositoryUrl}/releases`,
    notes: '',
    publishedAt: '',
    asset: null,
    installMode: packaged ? 'desktop-release' : 'source',
  };
  try {
    const release = await fetchLatestRelease({ force, fetchImpl });
    const latestVersion = String(release.tag_name || release.name || '').replace(/^v/i, '');
    return {
      ...base,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, base.currentVersion) > 0,
      releaseUrl: String(release.html_url || base.releaseUrl),
      notes: String(release.body || '').slice(0, 8000),
      publishedAt: String(release.published_at || ''),
      asset: selectReleaseAsset(release.assets || [], { platform, arch }),
    };
  } catch (error) {
    return { ...base, error: error?.message || String(error) };
  }
}

export function resetAppUpdateCache() {
  cache = { checkedAt: 0, release: null };
}
