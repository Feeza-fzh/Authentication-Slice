/**
 * Rate Limiting and Credential Stuffing Attack Protection Service
 *
 * Implements:
 * 1. Cost on failure: Maps (email, IP) and enforces strict lockout after 4 failed tries.
 * 2. Distinct credential stuffing defense:
 *    Detects automated attacks attempting multiple distinct accounts from the same IP address
 *    and blocks the attacking IP globally across all accounts.
 * 3. Integrates with PostgreSQL `login_attempts` table for persistent lockout records.
 */

const { prisma } = require('./db');

const MAX_FAILED_ATTEMPTS = 4; // Stop user after 4 failed tries per requirement
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15-minute sliding window
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15-minute lockout

// Credential stuffing thresholds per IP
const CREDENTIAL_STUFFING_MAX_EMAILS = 3; // IP trying 3+ distinct emails that fail
const CREDENTIAL_STUFFING_MAX_TOTAL = 6; // IP failing 6+ times across any accounts
const CREDENTIAL_STUFFING_BLOCK_MS = 30 * 60 * 1000; // 30-minute block for credential stuffing

class RateLimitService {
  constructor() {
    // Map of (emailNormalized + '::' + ip) -> { failedCount, windowStartedAt, lockedUntil }
    this.emailIpAttempts = new Map();

    // Map of ip -> { totalFailures, distinctEmails: Set, windowStartedAt, lockedUntil, isBlockedForStuffing }
    this.ipActivity = new Map();
  }

  /**
   * Generates composite key for email and IP address
   */
  getCompositeKey(emailNormalized, ip) {
    const cleanEmail = (emailNormalized || '').trim().toLowerCase();
    const cleanIp = (ip || '127.0.0.1').trim();
    return `${cleanEmail}::${cleanIp}`;
  }

  /**
   * Checks if login attempt is allowed or locked out
   * @param {string} emailNormalized
   * @param {string} ip
   * @throws {Error} If locked by rate limiting or credential stuffing defense
   */
  async checkAllowed(emailNormalized, ip) {
    const now = Date.now();
    const cleanIp = (ip || '127.0.0.1').trim();

    // 1. Check if IP is blocked for Credential Stuffing
    const ipRecord = this.ipActivity.get(cleanIp);
    if (ipRecord && ipRecord.lockedUntil && now < ipRecord.lockedUntil) {
      const waitMinutes = Math.max(1, Math.ceil((ipRecord.lockedUntil - now) / 60000));
      if (ipRecord.isBlockedForStuffing) {
        console.warn(`🚨 [Blocked] Credential stuffing attacker IP ${cleanIp} rejected (wait: ${waitMinutes}m)`);
        const err = new Error('Access temporarily blocked due to suspicious activity. Please try again later.');
        err.isRateLimited = true;
        err.isCredentialStuffing = true;
        throw err;
      }
    }

    // 2. Check in-memory composite (email + IP) lockout
    const compositeKey = this.getCompositeKey(emailNormalized, cleanIp);
    const attempt = this.emailIpAttempts.get(compositeKey);
    if (attempt && attempt.lockedUntil && now < attempt.lockedUntil) {
      const waitMinutes = Math.max(1, Math.ceil((attempt.lockedUntil - now) / 60000));
      console.warn(`⚠️ [Rate Limited] ${emailNormalized} from IP ${cleanIp} locked out after ${MAX_FAILED_ATTEMPTS} failed attempts.`);
      const err = new Error(`Too many failed login attempts. Please try again in ${waitMinutes} minute(s).`);
      err.isRateLimited = true;
      throw err;
    }

    // 3. Check persistent database login_attempts for this (email, IP) composite
    if (prisma && typeof prisma.loginAttempt?.findUnique === 'function') {
      try {
        const dbAttempt = await prisma.loginAttempt.findUnique({
          where: { emailNormalized: compositeKey }
        });
        if (dbAttempt && dbAttempt.lockedUntil && new Date() < new Date(dbAttempt.lockedUntil)) {
          const waitMinutes = Math.max(1, Math.ceil((new Date(dbAttempt.lockedUntil).getTime() - now) / 60000));
          const err = new Error(`Too many failed login attempts. Please try again in ${waitMinutes} minute(s).`);
          err.isRateLimited = true;
          throw err;
        }
      } catch (dbErr) {
        if (dbErr.isRateLimited) throw dbErr;
      }
    }
  }

  /**
   * Records a failed login attempt for the given email and IP
   * @param {string} emailNormalized
   * @param {string} ip
   * @returns {Promise<{ isLocked: boolean, isCredentialStuffing: boolean }>}
   */
  async recordFailure(emailNormalized, ip) {
    const now = Date.now();
    const cleanEmail = (emailNormalized || '').trim().toLowerCase();
    const cleanIp = (ip || '127.0.0.1').trim();
    const compositeKey = this.getCompositeKey(cleanEmail, cleanIp);

    // --- A. Update IP-wide activity tracking (Credential Stuffing Defense) ---
    let ipRecord = this.ipActivity.get(cleanIp);
    if (!ipRecord || (now - ipRecord.windowStartedAt > ATTEMPT_WINDOW_MS)) {
      ipRecord = {
        totalFailures: 1,
        distinctEmails: new Set([cleanEmail]),
        windowStartedAt: now,
        lockedUntil: null,
        isBlockedForStuffing: false
      };
    } else {
      ipRecord.totalFailures += 1;
      ipRecord.distinctEmails.add(cleanEmail);
    }

    // Check credential stuffing conditions:
    // Targeting multiple distinct emails OR high volume of failed logins from this single IP
    let isCredentialStuffing = false;
    if (
      ipRecord.distinctEmails.size >= CREDENTIAL_STUFFING_MAX_EMAILS ||
      ipRecord.totalFailures >= CREDENTIAL_STUFFING_MAX_TOTAL
    ) {
      isCredentialStuffing = true;
      ipRecord.isBlockedForStuffing = true;
      ipRecord.lockedUntil = now + CREDENTIAL_STUFFING_BLOCK_MS;
      console.warn(`🚨 [SECURITY ALERT: CREDENTIAL STUFFING ATTACK DETECTED]`);
      console.warn(`   Source IP: ${cleanIp}`);
      console.warn(`   Targeted ${ipRecord.distinctEmails.size} distinct accounts with ${ipRecord.totalFailures} failures in window.`);
      console.warn(`   Action: IP address blocked globally for 30 minutes.`);
    }
    this.ipActivity.set(cleanIp, ipRecord);

    // --- B. Update (email, IP) rate limiting counter ---
    let attempt = this.emailIpAttempts.get(compositeKey);
    if (!attempt || (now - attempt.windowStartedAt > ATTEMPT_WINDOW_MS)) {
      attempt = {
        failedCount: 1,
        windowStartedAt: now,
        lockedUntil: null
      };
    } else {
      attempt.failedCount += 1;
    }

    let isLocked = false;
    if (attempt.failedCount >= MAX_FAILED_ATTEMPTS) {
      isLocked = true;
      attempt.lockedUntil = now + LOCKOUT_DURATION_MS;
      console.warn(`🔒 [Account Rate Limited] Locked ${cleanEmail} for IP ${cleanIp} (4 failed attempts).`);
    }
    this.emailIpAttempts.set(compositeKey, attempt);

    // --- C. Persist to PostgreSQL database login_attempts table (email + IP) ---
    if (prisma && typeof prisma.loginAttempt?.upsert === 'function') {
      try {
        const lockedUntilDate = attempt.lockedUntil ? new Date(attempt.lockedUntil) : null;
        await prisma.loginAttempt.upsert({
          where: { emailNormalized: compositeKey },
          create: {
            emailNormalized: compositeKey,
            failedCount: attempt.failedCount,
            windowStartedAt: new Date(attempt.windowStartedAt),
            lockedUntil: lockedUntilDate
          },
          update: {
            failedCount: attempt.failedCount,
            lockedUntil: lockedUntilDate
          }
        });
      } catch (err) {
        console.warn('⚠️ [Database Pool] Could not update login_attempts:', err.message);
      }
    }

    return {
      failedCount: attempt.failedCount,
      isLocked,
      isCredentialStuffing
    };
  }

  /**
   * Resets failed attempts after a successful authentication
   * @param {string} emailNormalized
   * @param {string} ip
   */
  async recordSuccess(emailNormalized, ip) {
    const cleanEmail = (emailNormalized || '').trim().toLowerCase();
    const cleanIp = (ip || '127.0.0.1').trim();
    const compositeKey = this.getCompositeKey(cleanEmail, cleanIp);

    this.emailIpAttempts.delete(compositeKey);

    // Remove email from IP tracking set
    const ipRecord = this.ipActivity.get(cleanIp);
    if (ipRecord && ipRecord.distinctEmails) {
      ipRecord.distinctEmails.delete(cleanEmail);
    }

    if (prisma && typeof prisma.loginAttempt?.deleteMany === 'function') {
      try {
        await prisma.loginAttempt.deleteMany({
          where: { emailNormalized: compositeKey }
        });
      } catch (err) {
        // Non-fatal
      }
    }
  }

  /**
   * Clear all records (utility for tests)
   */
  clear() {
    this.emailIpAttempts.clear();
    this.ipActivity.clear();
  }
}

const rateLimitService = new RateLimitService();

module.exports = {
  RateLimitService,
  rateLimitService,
  MAX_FAILED_ATTEMPTS,
  ATTEMPT_WINDOW_MS,
  LOCKOUT_DURATION_MS
};
