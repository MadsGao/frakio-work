import { randomBytes } from 'node:crypto';

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((part) => part.length === 2));
}

export function createLocalSecurity({ port, development = false } = {}) {
  const sessionToken = randomBytes(32).toString('base64url');
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...(development ? ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:5174', 'http://localhost:5174'] : []),
    ...String(process.env.FRAKIO_WORK_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean),
  ]);

  function originAllowed(origin) {
    return !origin || allowedOrigins.has(origin);
  }

  function corsOptions(req, callback) {
    const origin = req.get('Origin');
    callback(null, {
      origin: originAllowed(origin),
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Frakio-Request'],
    });
  }

  function sessionRoute(_req, res) {
    res.setHeader('Set-Cookie', `frakio_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Strict; Path=/api`);
    res.json({ ok: true });
  }

  function protect(req, res, next) {
    if (!originAllowed(req.get('Origin'))) return res.status(403).json({ error: 'Origin is not allowed.' });
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const cookies = parseCookies(req.get('Cookie'));
    if (req.get('X-Frakio-Request') !== '1' || cookies.frakio_session !== sessionToken) {
      return res.status(403).json({ error: 'Local session validation failed.' });
    }
    return next();
  }

  return { allowedOrigins, corsOptions, sessionRoute, protect };
}
