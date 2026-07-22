import assert from 'node:assert/strict';
import test from 'node:test';
import { extractChatGptAccountId, fetchCodexOAuthCatalog, normalizeCodexCatalog } from './oauth-provider-catalog.mjs';

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

test('Codex catalog keeps provider priority and removes hidden and duplicate models', () => {
  const catalog = normalizeCodexCatalog({ models: [
    { slug: 'gpt-low', priority: 20 },
    { slug: 'gpt-hidden', priority: 1, visibility: 'hide' },
    { slug: 'gpt-high', priority: 10, supported_reasoning_levels: ['low', 'high'] },
    { slug: 'gpt-high', priority: 30 },
  ] });
  assert.deepEqual(catalog.models.map((model) => model.id), ['gpt-high', 'gpt-low']);
});

test('Codex catalog request sends the account id from the OAuth token', async () => {
  const accessToken = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-123' } });
  let request;
  const result = await fetchCodexOAuthCatalog({
    accessToken,
    endpoint: 'https://example.test/models',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ models: [{ slug: 'gpt-test', priority: 1 }] }), { status: 200 });
    },
  });
  assert.equal(extractChatGptAccountId(accessToken), 'acct-123');
  assert.equal(request.options.headers.Authorization, `Bearer ${accessToken}`);
  assert.equal(request.options.headers['ChatGPT-Account-Id'], 'acct-123');
  assert.equal(request.options.headers.originator, 'codex_cli_rs');
  assert.match(request.options.headers['User-Agent'], /codex_cli_rs/);
  assert.deepEqual(result.models.map((model) => model.id), ['gpt-test']);
});

test('Codex catalog rejects an empty account catalog', async () => {
  await assert.rejects(() => fetchCodexOAuthCatalog({
    accessToken: 'token',
    fetchImpl: async () => new Response(JSON.stringify({ models: [] }), { status: 200 }),
  }), /没有返回/);
});
