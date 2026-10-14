/**
 * Auth Service — Server-side handlers for registration, verification, sign-in, and password reset.
 * Connects directly to PostgreSQL via Prisma ORM with full persistence into database tables:
 * - users
 * - email_verification_codes
 * - sessions
 * - login_attempts
 * - password_reset_tokens
 */

require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { prisma } = require('./db');
const { signupIdempotency } = require('./idempotency');
const { rateLimitService } = require('./rate-limit.service');
const { SESSION_MAX_AGE } = require('./auth-cookies');

const { hashPassword, verifyPassword } = require('./password');
const {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  validate,
  parseFullName,
  ValidationError
} = require('./validation');
const {
  createVerificationCode,
  verifyCode,
  getVerificationRecord,
  generateVerificationCode
} = require('./verification.service');
const { emailQueue } = require('./jobs/email.queue');

// In-memory password reset store (keyed by normalized email)
const passwordResetStore = new Map();

/**
 * Record or update failed login attempts for an email to prevent brute-force probing.
 */
async function recordFailedLogin(emailNormalized, existingRecord) {
  if (!prisma) return;
  const now = new Date();
  try {
    if (!existingRecord) {
      await prisma.loginAttempt.create({
        data: {
          emailNormalized,
          failedCount: 1,
          windowStartedAt: now,
          lockedUntil: null
        }
      });
    } else {
      const newCount = (existingRecord.failedCount || 0) + 1;
      let lockedUntil = null;
      if (newCount >= 5) {
        // Lock out for 15 minutes after 5 consecutive failures
        lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await prisma.loginAttempt.update({
        where: { emailNormalized },
        data: {
          failedCount: newCount,
          lockedUntil
        }
      });
    }
  } catch (err) {
    console.warn('⚠️ [LoginAttempt] Error updating attempt counter:', err.message);
  }
}

/**
 * Register a new user and save to PostgreSQL database.
 * 1. Validates form payload with Zod.
 * 2. Checks for existing user in database.
 * 3. Hashes password with bcrypt (cost factor 15).
 * 4. Inserts user row into `users` table.
 * 5. Creates verification code and stores in `email_verification_codes` table.
 * 6. Enqueues background job to send email asynchronously.
 *
 * @param {object} rawData - { name, email, password }
 * @returns {Promise<object>} - { success, user, email, jobId, verificationCode }
 */
/**
 * Register a new user and save to PostgreSQL database.
 * 1. Validates form payload with Zod.
 * 2. Checks IdempotencyStore & in-flight single-flight mutex to eliminate duplicate processing.
 * 3. Hashes password with bcrypt (cost factor 15).
 * 4. Executes atomic transaction with explicit race condition rules for identical concurrent requests.
 * 5. Generates 5-minute temporary verification code in EmailVerificationCode table.
 * 6. Enqueues background email job (deduplicated).
 *
 * @param {object} rawData - { name, email, password }
 * @param {string} [idempotencyKey] - Optional client idempotency key
 * @returns {Promise<object>} - { success, user, email, jobId, verificationCode }
 */
async function registerUser(rawData, idempotencyKey = null) {
  // Validate input using Zod signUpSchema
  const validData = validate(signUpSchema, {
    name: rawData.name || rawData.fullName || '',
    email: rawData.email || '',
    password: rawData.password || ''
  });

  const parsedName = parseFullName(validData.name);
  const emailNormalized = validData.email; // Already trimmed and lowercased by Zod
  const key = signupIdempotency.getKey(idempotencyKey || rawData.idempotencyKey, emailNormalized);
  const emailKey = `email:${emailNormalized}`;

  // Execute within single-flight idempotency manager to deduplicate concurrent & repeated clicks
  return await signupIdempotency.runIdempotent(key, emailKey, async () => {
    // Rule 1: Check if an account already exists with this normalized email
    if (prisma && typeof prisma.user?.findUnique === 'function') {
      const existingUser = await prisma.user.findUnique({
        where: { emailNormalized }
      });
      if (existingUser) {
        // If created within last 2 minutes and still unverified, resolve idempotently
        if (!existingUser.emailVerifiedAt && Date.now() - new Date(existingUser.createdAt).getTime() < 120000) {
          console.log(`🛡️ [Race & Idempotency] Existing unverified user within 2-min window: ${emailNormalized}`);
          const activeCode = await prisma.emailVerificationCode.findFirst({
            where: { userId: existingUser.id, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: 'desc' }
          });
          return {
            success: true,
            user: existingUser,
            email: emailNormalized,
            name: parsedName.fullName,
            jobId: 'existing-job',
            verificationCode: activeCode ? '******' : null,
            expiresAt: activeCode ? activeCode.expiresAt : new Date(Date.now() + 5 * 60 * 1000),
            isIdempotentReplay: true
          };
        }
        throw new ValidationError('An account with this email address already exists.', {
          email: 'An account with this email address already exists.'
        });
      }
    }

    // Hash the password with bcrypt (cost factor 15)
    const passwordHash = await hashPassword(validData.password);

    // Generate 6-digit verification code using crypto.randomBytes(32) with 5-minute expiry
    const { code, expiresAt, codeHash } = await createVerificationCode(emailNormalized, parsedName.fullName);

    let user = null;
    if (prisma && typeof prisma.$transaction === 'function') {
      try {
        // Rule 2: Execute User and EmailVerificationCode creation in an atomic transaction
        user = await prisma.$transaction(async (tx) => {
          // Double check inside transaction for absolute race protection
          const existingInside = await tx.user.findUnique({ where: { emailNormalized } });
          if (existingInside) {
            if (!existingInside.emailVerifiedAt && Date.now() - new Date(existingInside.createdAt).getTime() < 120000) {
              return existingInside;
            }
            throw new ValidationError('An account with this email address already exists.', {
              email: 'An account with this email address already exists.'
            });
          }

          const createdUser = await tx.user.create({
            data: {
              name: parsedName.fullName,
              firstName: rawData.firstName || parsedName.firstName,
              middleName: rawData.middleName !== undefined ? rawData.middleName : parsedName.middleName,
              lastName: rawData.lastName || parsedName.lastName,
              email: emailNormalized,
              emailNormalized,
              passwordHash
            },
            select: {
              id: true,
              name: true,
              firstName: true,
              middleName: true,
              lastName: true,
              email: true,
              emailNormalized: true,
              createdAt: true
            }
          });

          // Rule 4: Clear prior codes and store temporary 5-min code atomically
          await tx.emailVerificationCode.deleteMany({
            where: { userId: createdUser.id }
          });
          await tx.emailVerificationCode.create({
            data: {
              userId: createdUser.id,
              codeHash,
              expiresAt
            }
          });

          return createdUser;
        });
        console.log(`💾 [Database Pool] Successfully created User & temporary code in transaction: ${user.id} (${user.email})`);
      } catch (err) {
        // Rule 3: Deterministic handling of unique constraint collision (P2002) from simultaneous external requests
        if (err.code === 'P2002') {
          console.warn(`🛡️ [Race Handled] Concurrent insertion P2002 for ${emailNormalized}`);
          const raceUser = await prisma.user.findUnique({ where: { emailNormalized } });
          if (raceUser && !raceUser.emailVerifiedAt && Date.now() - new Date(raceUser.createdAt).getTime() < 120000) {
            user = raceUser;
          } else {
            throw new ValidationError('An account with this email address already exists.', {
              email: 'An account with this email address already exists.'
            });
          }
        } else {
          throw err;
        }
      }
    } else {
      user = {
        id: 'mock-user-id',
        name: parsedName.fullName,
        email: emailNormalized,
        createdAt: new Date()
      };
    }

    // Rule 5: Deduplicated email dispatch - only enqueued ONCE for single-flight execution
    const jobId = emailQueue.enqueue({
      type: 'SEND_VERIFICATION_EMAIL',
      payload: {
        to: emailNormalized,
        code,
        name: parsedName.fullName
      }
    });

    return {
      success: true,
      user,
      email: emailNormalized,
      name: parsedName.fullName,
      jobId,
      verificationCode: code,
      expiresAt
    };
  });
}

/**
 * Verify submitted email verification code and activate user account in database.
 *
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{ success: boolean, message?: string, user?: object }>}
 */
async function verifyUserEmail(email, code) {
  // Validate input via Zod verifyEmailSchema
  validate(verifyEmailSchema, { email, code });

  const emailNormalized = email.trim().toLowerCase();
  let verified = false;
  let dbUser = null;

  // 1. Verify against database temporary EmailVerificationCode record if available
  if (prisma && typeof prisma.user?.findUnique === 'function') {
    dbUser = await prisma.user.findUnique({
      where: { emailNormalized },
      include: {
        verificationCodes: {
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (dbUser && dbUser.verificationCodes && dbUser.verificationCodes.length > 0) {
      const activeCodeRecord = dbUser.verificationCodes[0];

      // Check 5-minute validity window
      if (new Date() > new Date(activeCodeRecord.expiresAt)) {
        // Delete expired temporary code record
        await prisma.emailVerificationCode.deleteMany({
          where: { userId: dbUser.id }
        });
        return {
          success: false,
          message: 'Verification code has expired. Please request a new code.'
        };
      }

      // Check max attempts
      if (activeCodeRecord.attempts >= 5) {
        await prisma.emailVerificationCode.deleteMany({
          where: { userId: dbUser.id }
        });
        return {
          success: false,
          message: 'Too many incorrect attempts. Please request a new code.'
        };
      }

      // Validate bcrypt hash of verification code
      const isMatch = await bcrypt.compare(code.trim(), activeCodeRecord.codeHash);
      if (!isMatch) {
        await prisma.emailVerificationCode.update({
          where: { id: activeCodeRecord.id },
          data: { attempts: { increment: 1 } }
        });
        return { success: false, message: 'That code is incorrect.' };
      }

      verified = true;
    }
  }

  // 2. Fallback to in-memory verification store if not verified via DB
  if (!verified) {
    const memResult = await verifyCode(emailNormalized, code);
    if (!memResult.success) {
      return memResult;
    }
    verified = true;
  }

  // 3. Mark user verified and DELETE temporary EmailVerificationCode records from database
  if (prisma && typeof prisma.user?.update === 'function') {
    try {
      const updatedUser = await prisma.user.update({
        where: { emailNormalized },
        data: { emailVerifiedAt: new Date() },
        select: {
          id: true,
          name: true,
          firstName: true,
          email: true,
          emailVerifiedAt: true
        }
      });

      // DELETE the temporary EmailVerificationCode records once email has been verified
      const deleteResult = await prisma.emailVerificationCode.deleteMany({
        where: {
          userId: updatedUser.id
        }
      });
      console.log(`🗑️ [Database] Deleted ${deleteResult.count} temporary EmailVerificationCode record(s) for userId: ${updatedUser.id}`);
      signupIdempotency.invalidate(`email:${emailNormalized}`);

      // Create an active Session row in database
      const sessionToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      await prisma.session.create({
        data: {
          userId: updatedUser.id,
          tokenHash,
          type: 'full',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      });

      console.log(`💾 [Database] Marked email verified and created session for: ${updatedUser.email}`);
      return {
        success: true,
        user: updatedUser,
        sessionToken,
        message: 'Email verified successfully.'
      };
    } catch (err) {
      console.error('❌ [Database Error] Error updating email verification in database:', err);
    }
  }

  const fallbackToken = crypto.randomBytes(32).toString('hex');
  return {
    success: true,
    sessionToken: fallbackToken,
    message: 'Email verified successfully.'
  };
}

/**
 * Resend verification email code.
 * Generates a new code, saves to database with 5-minute validity, and queues background email job.
 *
 * @param {string} email
 * @returns {Promise<{ success: boolean, jobId: string, code: string }>}
 */
async function resendVerificationEmail(email) {
  const emailNormalized = (email || '').trim().toLowerCase();
  const existing = getVerificationRecord(emailNormalized);
  let name = existing ? existing.name : '';

  let dbUser = null;
  if (prisma && typeof prisma.user?.findUnique === 'function') {
    dbUser = await prisma.user.findUnique({
      where: { emailNormalized }
    });
    if (dbUser) {
      name = dbUser.name;
    }
  }

  // Generate new code using crypto.randomBytes(32) and bcrypt (5-minute expiry)
  const { code, expiresAt, codeHash } = await createVerificationCode(emailNormalized, name);

  if (prisma && dbUser) {
    try {
      // Clear previous temporary verification codes for this user
      await prisma.emailVerificationCode.deleteMany({
        where: { userId: dbUser.id }
      });

      // Insert new temporary verification code record valid for 5 minutes
      await prisma.emailVerificationCode.create({
        data: {
          userId: dbUser.id,
          codeHash,
          expiresAt
        }
      });
      console.log(`💾 [Database] Created new temporary verification code record for: ${dbUser.email} (valid for 5 mins until ${expiresAt.toISOString()})`);
    } catch (dbErr) {
      console.warn('⚠️ [Database] Error saving resent verification code:', dbErr.message);
    }
  }

  // Enqueue background email job
  const jobId = emailQueue.enqueue({
    type: 'SEND_VERIFICATION_EMAIL',
    payload: {
      to: emailNormalized,
      code,
      name
    }
  });

  return {
    success: true,
    jobId,
    verificationCode: code,
    expiresAt
  };
}

/**
 * Authenticate a user during sign-in using database credentials.
 * Implements:
 * 1. Vague error messaging: returns "Invalid email or password." without distinguishing email vs password.
 * 2. Cost on failure: Enforces 4-try rate limiting mapped to IP address.
 * 3. Credential stuffing protection: Treats multi-account credential stuffing as a distinct attack.
 * 4. Sessions: Generates sessionToken and creates record in `sessions` table (sessions age and die on their own).
 *
 * @param {string} email - The submitted email address
 * @param {string} password - The submitted plain text password
 * @param {string} [ip] - The client IP address
 * @returns {Promise<{ user: object, sessionToken: string, expiresAt: Date }>}
 */
async function authenticateUser(email, password, ip = '127.0.0.1') {
  const validData = validate(signInSchema, { email, password });
  const emailNormalized = validData.email;

  // 1. Check rate limits & credential stuffing locks for this (email, IP)
  await rateLimitService.checkAllowed(emailNormalized, ip);

  if (prisma && typeof prisma.user?.findUnique === 'function') {
    // Look up user by normalized email
    const user = await prisma.user.findUnique({
      where: { emailNormalized }
    });

    if (!user) {
      // Record failure for rate limiting and credential stuffing tracking
      await rateLimitService.recordFailure(emailNormalized, ip);
      // Constant-time dummy verification to prevent timing side-channel attacks
      const DUMMY_BCRYPT_HASH = '$2b$15$r7FwA97q6zP4bA3ZtGZlXeK1N5m4vYwV7a5a8q2s1d3f4g5h6j7k8';
      await verifyPassword(validData.password, DUMMY_BCRYPT_HASH);
      // VAGUE ERROR MESSAGE: Never reveal whether email or password was wrong
      throw new ValidationError('Invalid email or password.');
    }

    const isValid = await verifyPassword(validData.password, user.passwordHash);
    if (!isValid) {
      // Record failure for rate limiting and credential stuffing tracking
      await rateLimitService.recordFailure(emailNormalized, ip);
      // VAGUE ERROR MESSAGE: Never reveal whether email or password was wrong
      throw new ValidationError('Invalid email or password.');
    }

    // Clear failed login attempts on successful credentials
    await rateLimitService.recordSuccess(emailNormalized, ip);

    // Create session in `sessions` table (30-day TTL — sessions age and die on their own)
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000);

    try {
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash,
          type: user.emailVerifiedAt ? 'full' : 'pending_verification',
          expiresAt
        }
      });
      console.log(`💾 [Database Pool] Created new session record for User: ${user.id} (expires in 30 days)`);
    } catch (sessErr) {
      console.warn('⚠️ [Database] Session creation error:', sessErr.message);
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        firstName: user.firstName,
        email: user.email,
        isVerified: !!user.emailVerifiedAt
      },
      sessionToken,
      expiresAt
    };
  }

  // Fallback if database is not active
  return {
    user: {
      id: 'mock-user-id',
      name: emailNormalized.split('@')[0],
      email: emailNormalized,
      isVerified: true
    },
    sessionToken: crypto.randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000)
  };
}

/**
 * Validates a session token from cookies/headers.
 * Confirms that sessions age and die on their own via `expiresAt` and `revokedAt`.
 *
 * @param {string} sessionToken
 * @returns {Promise<object|null>}
 */
async function validateSession(sessionToken) {
  if (!sessionToken || typeof sessionToken !== 'string') return null;

  if (prisma && typeof prisma.session?.findFirst === 'function') {
    try {
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      const session = await prisma.session.findFirst({
        where: { tokenHash },
        include: { user: true }
      });

      if (!session) return null;

      // Check if session was revoked (serverside logout)
      if (session.revokedAt) {
        console.log(`🚫 [Session] Session was revoked serverside on ${session.revokedAt}`);
        return null;
      }

      // Check if session has aged and died on its own
      if (new Date() > new Date(session.expiresAt)) {
        console.log(`⏰ [Session] Session has aged and expired at ${session.expiresAt}`);
        return null;
      }

      return {
        session,
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          isVerified: !!session.user.emailVerifiedAt
        }
      };
    } catch (err) {
      console.warn('⚠️ [Session Validation Error]', err.message);
      return null;
    }
  }

  return null;
}

/**
 * Serverside logout — revokes session in the database so it can never be used again.
 *
 * @param {string} sessionToken
 * @returns {Promise<boolean>}
 */
async function revokeSession(sessionToken) {
  if (!sessionToken || typeof sessionToken !== 'string') return false;

  if (prisma && typeof prisma.session?.updateMany === 'function') {
    try {
      const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      const result = await prisma.session.updateMany({
        where: {
          tokenHash,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      });
      console.log(`🚪 [Session Revoked] Successfully revoked ${result.count} session(s) serverside.`);
      return true;
    } catch (err) {
      console.warn('⚠️ [Session Revoke Error]', err.message);
      return false;
    }
  }

  return true;
}

/**
 * Request password reset (Forgot password).
 * Generates a 6-digit verification code, saves in `password_reset_tokens` table, and queues email.
 *
 * @param {string} email - The user's submitted email
 * @returns {Promise<{ success: boolean, email: string, verificationCode?: string, message: string }>}
 */
async function requestPasswordReset(email) {
  const validData = validate(forgotPasswordSchema, { email });
  const emailNormalized = validData.email;
  const code = generateVerificationCode();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store in memory for instant verification/fallback
  passwordResetStore.set(emailNormalized, {
    code,
    codeHash,
    expiresAt: expiresAt.getTime(),
    attempts: 0
  });

  if (prisma && typeof prisma.user?.findUnique === 'function') {
    try {
      const user = await prisma.user.findUnique({
        where: { emailNormalized }
      });

      if (user) {
        // Invalidate old tokens
        await prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null, voidedAt: null },
          data: { voidedAt: new Date() }
        });

        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: codeHash,
            expiresAt
          }
        });

        console.log(`💾 [Database] Created PasswordResetToken record for user: ${user.id} (code: ${code})`);

        // Queue password reset email
        emailQueue.enqueue({
          type: 'SEND_VERIFICATION_EMAIL',
          payload: {
            to: emailNormalized,
            code,
            name: user.name,
            subject: 'Password Reset Verification Code'
          }
        });
      }
    } catch (err) {
      console.warn('⚠️ [Database] Password reset error:', err.message);
    }
  }

  return {
    success: true,
    email: emailNormalized,
    verificationCode: code,
    expiresAt,
    message: 'If an account exists for that email, we sent a verification code.'
  };
}

/**
 * Verify a 6-digit password reset verification code sent to the user's email.
 *
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{ success: boolean, email: string, code: string, message: string }>}
 */
async function verifyPasswordResetCode(email, code) {
  const emailNormalized = (email || '').trim().toLowerCase();
  const cleanCode = (code || '').trim().toUpperCase();

  if (!emailNormalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNormalized)) {
    throw new ValidationError('Enter a valid email address.', { email: 'Enter a valid email address.' });
  }

  if (!cleanCode || cleanCode.length !== 6 || !/^[a-zA-Z0-9]{6}$/.test(cleanCode)) {
    throw new ValidationError('Enter the 6-character code.', { code: 'Enter the 6-character code.' });
  }

  const codeHash = crypto.createHash('sha256').update(cleanCode).digest('hex');
  let isValid = false;

  // 1. Check database if available
  if (prisma && typeof prisma.user?.findUnique === 'function') {
    try {
      const user = await prisma.user.findUnique({
        where: { emailNormalized }
      });

      if (user) {
        const tokenRecord = await prisma.passwordResetToken.findFirst({
          where: {
            userId: user.id,
            usedAt: null,
            voidedAt: null,
            expiresAt: { gt: new Date() }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (tokenRecord && tokenRecord.tokenHash === codeHash) {
          isValid = true;
        }
      }
    } catch (dbErr) {
      console.warn('⚠️ [Database] Verify reset code error:', dbErr.message);
    }
  }

  // 2. Check in-memory store fallback
  if (!isValid) {
    const memRecord = passwordResetStore.get(emailNormalized);
    if (memRecord && Date.now() < memRecord.expiresAt && memRecord.code === cleanCode) {
      isValid = true;
    }
  }

  if (!isValid) {
    throw new ValidationError('That verification code is incorrect or has expired.', {
      code: 'That verification code is incorrect or has expired.'
    });
  }

  return {
    success: true,
    email: emailNormalized,
    code: cleanCode,
    message: 'Verification code confirmed.'
  };
}

/**
 * Reset a user's password in the database.
 * Validates matching passwords, checks complexity, updates database, and revokes sessions.
 *
 * @param {object} resetData - { email, code, token, newPassword, confirmPassword, userId }
 * @returns {Promise<object>}
 */
async function resetUserPassword(resetData) {
  const email = (resetData.email || '').trim().toLowerCase();
  const code = (resetData.code || '').trim();
  const newPassword = resetData.newPassword || '';
  const confirmPassword = resetData.confirmPassword || '';

  // Validate confirmPassword presence
  if (!confirmPassword) {
    throw new ValidationError('Confirm new password field cannot be empty', {
      confirmPassword: 'Confirm new password field cannot be empty'
    });
  }

  // Passwords match validation per requirement
  if (newPassword !== confirmPassword) {
    throw new ValidationError('Passwords do not match. Please re-enter your passwords.', {
      confirmPassword: 'Passwords do not match. Please re-enter your passwords.'
    });
  }

  // Validate using Zod schema
  const validData = validate(resetPasswordSchema, {
    token: code || resetData.token || 'code_verified',
    newPassword,
    confirmPassword
  });

  // Verify the code if email was supplied
  if (email && code) {
    await verifyPasswordResetCode(email, code);
  }

  const passwordHash = await hashPassword(validData.newPassword);

  if (prisma && typeof prisma.user?.findUnique === 'function') {
    let user = null;
    if (email) {
      user = await prisma.user.findUnique({ where: { emailNormalized: email } });
    } else if (resetData.userId) {
      user = await prisma.user.findUnique({ where: { id: resetData.userId } });
    }

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          updatedAt: new Date()
        }
      });

      // Mark token as used
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() }
      });

      // Revoke any active sessions serverside
      await prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() }
      });

      console.log(`💾 [Database] Password updated in database for user: ${user.id} (${user.email})`);
    }
  }

  if (email) {
    passwordResetStore.delete(email);
  }

  return {
    success: true,
    email,
    message: 'Password updated successfully.'
  };
}

module.exports = {
  registerUser,
  verifyUserEmail,
  resendVerificationEmail,
  authenticateUser,
  validateSession,
  revokeSession,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetUserPassword,
  ValidationError,
  rateLimitService,
  prisma
};
