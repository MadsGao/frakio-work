'use strict';

const EXACT_EXTERNAL_PATHS = new Map([
  ['auth.openai.com', new Set(['/codex/device'])],
  ['claude.ai', new Set(['/oauth/authorize'])],
  ['accounts.google.com', new Set(['/o/oauth2/v2/auth'])],
]);

function isAllowedExternalUrl(targetUrl) {
  try {
    const url = new URL(String(targetUrl || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.hostname === 'github.com') {
      return url.pathname.startsWith('/MadsGao/frakio-work/releases/');
    }
    return EXACT_EXTERNAL_PATHS.get(url.hostname)?.has(url.pathname) === true;
  } catch {
    return false;
  }
}

module.exports = { isAllowedExternalUrl };
