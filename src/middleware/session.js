const crypto = require('node:crypto');

const COOKIE_NAME = 'mf_session';
const MAX_AGE_SECONDS = 8 * 60 * 60; // 8 hours
const MAX_AGE_MS = MAX_AGE_SECONDS * 1000;

function getSecret() {
  return process.env.SESSION_SECRET || 'marketflow-sad-demo-session-secret';
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) {
      try {
        cookies[key] = decodeURIComponent(val);
      } catch (_) {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function signToken(payloadB64) {
  return crypto
    .createHmac('sha256', getSecret())
    .update(payloadB64)
    .digest('base64url');
}

function encodeSession(userId) {
  const payload = JSON.stringify({
    uid: Number(userId),
    exp: Date.now() + MAX_AGE_MS
  });
  const payloadB64 = Buffer.from(payload, 'utf8').toString('base64url');
  const sig = signToken(payloadB64);
  return `${payloadB64}.${sig}`;
}

function decodeSession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, providedSig] = parts;
  if (!payloadB64 || !providedSig) return null;

  const expectedSig = signToken(payloadB64);
  const a = Buffer.from(providedSig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!Number.isInteger(parsed.uid) || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
      return null;
    }
    return parsed.uid;
  } catch (_) {
    return null;
  }
}

function sessionMiddleware() {
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const verifiedUserId = decodeSession(cookies[COOKIE_NAME]);
    const isHttps = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');

    req.session = {
      userId: verifiedUserId,
      setUser(userId) {
        this.userId = Number(userId);
        const token = encodeSession(this.userId);
        res.cookie(COOKIE_NAME, token, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: MAX_AGE_MS,
          secure: isHttps
        });
      },
      destroy(cb) {
        this.userId = null;
        res.clearCookie(COOKIE_NAME, {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          secure: isHttps
        });
        if (typeof cb === 'function') cb(null);
      }
    };

    next();
  };
}

module.exports = {
  COOKIE_NAME,
  sessionMiddleware
};
