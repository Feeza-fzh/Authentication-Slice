/**
 * Authentication API Request Handlers
 * Wires HTTP requests from frontend forms directly to PostgreSQL database via auth service.
 * Supports:
 * - Auth.js compliant session cookies (HttpOnly, SameSite=Lax, Secure in prod, 30-day maxAge)
 * - Auth.js CSRF token generation and validation for POST requests
 * - Vague error messaging on login failure ("Invalid email or password.")
 * - Cost on failure: Rate limiting after 4 failed tries (mapped 1 email to 1 IP)
 * - Credential stuffing defense as a distinct attack
 * - Serverside logout with immediate DB session revocation and cookie clearing
 * - Auto-expiring sessions that age and die on their own
 */

require('dotenv').config();

const {
  registerUser,
  verifyUserEmail,
  resendVerificationEmail,
  authenticateUser,
  validateSession,
  revokeSession,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetUserPassword,
  ValidationError
} = require('./auth.service');
const { emailQueue } = require('./jobs/email.queue');
const {
  createSessionCookie,
  createClearSessionCookie,
  generateCsrfToken,
  createCsrfCookie,
  getCsrfFromRequest,
  getSessionTokenFromRequest
} = require('./auth-cookies');

/**
 * Extracts client IP address from HTTP request headers or socket
 * @param {object} req
 * @returns {string}
 */
function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
}

/**
 * Handles incoming HTTP requests for auth endpoints.
 * Compatible with Connect / Express / Vite dev server middleware.
 */
function handleAuthApiRequest(req, res, next) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  console.log(`\n📡 [API Request] ${req.method} ${pathname} (${new Date().toLocaleTimeString()})`);

  // 1. GET /api/auth/csrf — Generate/return Auth.js CSRF token
  if (pathname === '/api/auth/csrf' && req.method === 'GET') {
    let token = getCsrfFromRequest(req);
    if (!token) {
      token = generateCsrfToken();
    }
    const cookieHeader = createCsrfCookie(token);
    res.setHeader('Set-Cookie', [cookieHeader]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ csrfToken: token }));
    return true;
  }

  // 2. GET /api/auth/session — Check session validity (sessions age and die on their own)
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    const sessionToken = getSessionTokenFromRequest(req);
    validateSession(sessionToken).then((sessionData) => {
      if (!sessionData) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: null, authenticated: false }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: sessionData.user, authenticated: true }));
    }).catch(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: null, authenticated: false }));
    });
    return true;
  }

  // 3. GET /api/jobs/:id — Job status polling
  if (pathname.startsWith('/api/jobs/') && req.method === 'GET') {
    const jobId = pathname.replace('/api/jobs/', '');
    const job = emailQueue.getJob(jobId);
    if (!job) {
      console.log(`❌ [API Jobs] Job not found: ${jobId}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ job }));
    return true;
  }

  if (req.method !== 'POST') {
    if (typeof next === 'function') {
      return next();
    }
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return false;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    let payload = {};
    try {
      payload = body ? JSON.parse(body) : {};
    } catch (e) {
      console.error(`❌ [API Error] Invalid JSON payload received on ${pathname}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      return;
    }

    try {
      const clientIp = getClientIp(req);

      // 1. Sign Up / Register
      if (pathname === '/api/auth/register') {
        const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || payload.idempotencyKey || null;
        console.log(`👤 [API Register] Received registration for: ${payload.email} (${payload.name})${idempotencyKey ? ` [Key: ${idempotencyKey}]` : ''}`);
        const result = await registerUser(payload, idempotencyKey);
        console.log(`✅ [API Register] ${result.isIdempotentReplay ? 'Idempotent response returned' : 'User created in database and email enqueued'}: ${result.jobId}`);
        const responseHeaders = { 'Content-Type': 'application/json' };
        if (result.isIdempotentReplay) {
          responseHeaders['X-Idempotent-Replay'] = 'true';
        }
        res.writeHead(200, responseHeaders);
        res.end(JSON.stringify(result));
        return;
      }

      // 2. Sign In / Login (with Auth.js cookies, CSRF validation, rate limiting & credential stuffing protection)
      if (pathname === '/api/auth/sign-in' || pathname === '/api/auth/login') {
        console.log(`🔐 [API Sign In] Sign-in attempt for: ${payload.email} from IP: ${clientIp}`);

        // CSRF Token Validation
        const cookieCsrf = getCsrfFromRequest(req);
        const submittedCsrf = req.headers['x-csrf-token'] || req.headers['csrf-token'] || payload.csrfToken;

        if (cookieCsrf && submittedCsrf && cookieCsrf !== submittedCsrf) {
          console.warn(`🛡️ [CSRF Block] Mismatched CSRF token for ${payload.email}`);
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid CSRF token' }));
          return;
        }

        // Authenticate with IP tracking for 4-try rate limit & credential stuffing defense
        const authResult = await authenticateUser(payload.email, payload.password, clientIp);

        // Generate Auth.js compliant session cookie (HttpOnly, SameSite=Lax, Max-Age 30 days)
        const sessionCookie = createSessionCookie(authResult.sessionToken);
        res.setHeader('Set-Cookie', [sessionCookie]);

        console.log(`🎉 [API Sign In Success] User authenticated & session cookie set: ${authResult.user.email}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          user: authResult.user
        }));
        return;
      }

      // 3. Sign Out / Logout (Always Serverside)
      if (pathname === '/api/auth/sign-out' || pathname === '/api/auth/logout') {
        console.log(`🚪 [API Sign Out] Serverside logout requested from IP: ${clientIp}`);
        const sessionToken = getSessionTokenFromRequest(req) || payload.sessionToken;

        if (sessionToken) {
          await revokeSession(sessionToken);
        }

        // Clear session cookies immediately on server response
        const clearCookies = createClearSessionCookie();
        res.setHeader('Set-Cookie', clearCookies);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Signed out successfully.' }));
        return;
      }

      // 4. Verify Code
      if (pathname === '/api/auth/verify-code') {
        if (payload.type === 'reset') {
          console.log(`🔑 [API Verify Reset Code via /verify-code] Attempt for: ${payload.email} (code: ${payload.code})`);
          const result = await verifyPasswordResetCode(payload.email, payload.code);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

        console.log(`🔑 [API Verify Code] Attempt for: ${payload.email} (code: ${payload.code})`);
        const result = await verifyUserEmail(payload.email, payload.code);
        if (!result.success) {
          console.warn(`⚠️ [API Verify Code Failed] ${payload.email}: ${result.message}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: result.message }));
          return;
        }
        console.log(`🎉 [API Verify Code Success] Email verified in database for: ${payload.email}`);
        if (result.sessionToken) {
          const sessionCookie = createSessionCookie(result.sessionToken);
          res.setHeader('Set-Cookie', [sessionCookie]);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Email verified successfully.', user: result.user }));
        return;
      }

      // 5. Resend Code
      if (pathname === '/api/auth/resend-code') {
        console.log(`🔄 [API Resend Code] Resending verification code for: ${payload.email}`);
        const result = await resendVerificationEmail(payload.email);
        console.log(`✅ [API Resend Code] Resend job enqueued: ${result.jobId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // 6. Forgot Password (generate & send verification code)
      if (pathname === '/api/auth/forgot-password') {
        console.log(`✉️ [API Forgot Password] Verification code request for: ${payload.email}`);
        const result = await requestPasswordReset(payload.email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // 6b. Verify Reset Code
      if (pathname === '/api/auth/verify-reset-code') {
        console.log(`🔑 [API Verify Reset Code] Attempt for: ${payload.email} (code: ${payload.code})`);
        const result = await verifyPasswordResetCode(payload.email, payload.code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // 7. Reset Password
      if (pathname === '/api/auth/reset-password') {
        console.log(`🔄 [API Reset Password] Password reset attempt for: ${payload.email}`);
        const result = await resetUserPassword(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // 404 Not Found
      console.warn(`⚠️ [API 404] Unknown endpoint: ${pathname}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    } catch (err) {
      console.error(`💥 [API Error] ${pathname}:`, err.message);

      // Handle Rate Limiting & Credential Stuffing lockouts (HTTP 429)
      if (err.isRateLimited) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: err.message,
          isRateLimited: true,
          isCredentialStuffing: !!err.isCredentialStuffing
        }));
        return;
      }

      // Handle Vague Credentials Error (HTTP 401)
      if (err instanceof ValidationError && err.message === 'Invalid email or password.') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid email or password.' }));
        return;
      }

      if (err instanceof ValidationError) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, errors: err.errors }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
      }
    }
  });

  return true;
}

module.exports = {
  handleAuthApiRequest,
  getClientIp
};
