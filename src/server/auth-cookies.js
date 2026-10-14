/**
 * Auth.js Compatible Cookie & CSRF Configuration
 *
 * Implements Auth.js (NextAuth.js) standard security policies:
 * - Session Cookie: `authjs.session-token` (or `__Secure-authjs.session-token` in production)
 * - CSRF Cookie: `authjs.csrf-token` (or `__Host-authjs.csrf-token` in production)
 * - Attributes: HttpOnly, SameSite=Lax, Secure in production, MaxAge (30 days)
 */

const crypto = require('crypto');

const isProd = process.env.NODE_ENV === 'production';

const COOKIE_NAMES = {
  sessionToken: isProd ? '__Secure-authjs.session-token' : 'authjs.session-token',
  csrfToken: isProd ? '__Host-authjs.csrf-token' : 'authjs.csrf-token'
};

const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds
const CSRF_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

/**
 * Parses HTTP Cookie header into key-value map
 * @param {object} req - HTTP request
 * @returns {object}
 */
function parseCookies(req) {
  const cookies = {};
  const header = req.headers?.cookie;
  if (!header) return cookies;
  header.split(';').forEach((part) => {
    const [name, ...val] = part.split('=');
    if (!name) return;
    cookies[name.trim()] = decodeURIComponent(val.join('=').trim());
  });
  return cookies;
}

/**
 * Serializes an Auth.js session cookie
 * @param {string} token - Session token
 * @returns {string}
 */
function createSessionCookie(token) {
  return `${COOKIE_NAMES.sessionToken}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${isProd ? '; Secure' : ''}`;
}

/**
 * Serializes cookies to delete the Auth.js session cookie
 * @returns {string[]}
 */
function createClearSessionCookie() {
  const clear1 = `${COOKIE_NAMES.sessionToken}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${isProd ? '; Secure' : ''}`;
  const clear2 = `authjs.session-token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  return [clear1, clear2];
}

/**
 * Generates cryptographically secure CSRF token
 * @returns {string}
 */
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Serializes an Auth.js CSRF cookie
 * @param {string} token - CSRF token
 * @returns {string}
 */
function createCsrfCookie(token) {
  return `${COOKIE_NAMES.csrfToken}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CSRF_MAX_AGE}${isProd ? '; Secure' : ''}`;
}

/**
 * Extracts CSRF token from incoming request cookies
 * @param {object} req
 * @returns {string|null}
 */
function getCsrfFromRequest(req) {
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAMES.csrfToken] || cookies['authjs.csrf-token'] || cookies['__Host-authjs.csrf-token'] || null;
}

/**
 * Extracts session token from incoming request cookies
 * @param {object} req
 * @returns {string|null}
 */
function getSessionTokenFromRequest(req) {
  const cookies = parseCookies(req);
  return (
    cookies[COOKIE_NAMES.sessionToken] ||
    cookies['authjs.session-token'] ||
    cookies['__Secure-authjs.session-token'] ||
    null
  );
}

module.exports = {
  COOKIE_NAMES,
  SESSION_MAX_AGE,
  isProd,
  parseCookies,
  createSessionCookie,
  createClearSessionCookie,
  generateCsrfToken,
  createCsrfCookie,
  getCsrfFromRequest,
  getSessionTokenFromRequest
};
