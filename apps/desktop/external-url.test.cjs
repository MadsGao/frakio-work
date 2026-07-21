'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isAllowedExternalUrl } = require('./external-url.cjs');

test('allows only approved external authorization and release URLs', () => {
  const allowed = [
    'https://auth.openai.com/codex/device',
    'https://claude.ai/oauth/authorize?code=true',
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
    'https://github.com/MadsGao/frakio-work/releases/tag/v0.1.4',
  ];
  for (const url of allowed) assert.equal(isAllowedExternalUrl(url), true, url);

  const denied = [
    'http://auth.openai.com/codex/device',
    'https://auth.openai.com/codex/device/extra',
    'https://auth.openai.com.evil.example/codex/device',
    'https://claude.ai/oauth/authorize/extra',
    'https://accounts.google.com.evil.example/o/oauth2/v2/auth',
    'https://github.com/MadsGao/frakio-work/issues',
    'javascript:alert(1)',
  ];
  for (const url of denied) assert.equal(isAllowedExternalUrl(url), false, url);
});
