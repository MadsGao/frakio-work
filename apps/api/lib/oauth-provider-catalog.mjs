function clean(value) { return String(value || '').trim(); }

export function extractChatGptAccountId(accessToken) {
  try {
    const payload = clean(accessToken).split('.')[1];
    if (!payload) return '';
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return clean(decoded?.['https://api.openai.com/auth']?.chatgpt_account_id);
  } catch {
    return '';
  }
}

export function normalizeCodexCatalog(body) {
  const rows = Array.isArray(body?.models) ? body.models : [];
  const visible = rows
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item, id: clean(item.slug || item.id), _priority: Number(item.priority) }))
    .filter((item) => item.id && !['hide', 'hidden'].includes(clean(item.visibility).toLowerCase()))
    .sort((left, right) => {
      const leftPriority = Number.isFinite(left._priority) ? left._priority : 10000;
      const rightPriority = Number.isFinite(right._priority) ? right._priority : 10000;
      return leftPriority - rightPriority || left.id.localeCompare(right.id);
    })
    .map(({ _priority, ...item }) => item);
  const seen = new Set();
  return { models: visible.filter((item) => !seen.has(item.id) && seen.add(item.id)) };
}

export async function fetchCodexOAuthCatalog({ accessToken, fetchImpl = fetch, endpoint = 'https://chatgpt.com/backend-api/codex/models?client_version=1.0.0', timeoutMs = 10000 }) {
  const token = clean(accessToken);
  if (!token) throw new Error('Codex 授权凭据不可用。');
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'codex_cli_rs/0.0.0 (Frakio Work)',
    originator: 'codex_cli_rs',
  };
  const accountId = extractChatGptAccountId(token);
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  const response = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const error = new Error(`Codex 模型目录获取失败：HTTP ${response.status}`);
    error.status = response.status;
    error.code = response.status === 401 ? 'oauth_expired' : response.status === 403 ? 'provider_rejected' : 'catalog_refresh_failed';
    throw error;
  }
  const catalog = normalizeCodexCatalog(await response.json());
  if (!catalog.models.length) throw new Error('Codex 模型目录没有返回当前账号可用的模型。');
  return { ...catalog, accountId };
}
