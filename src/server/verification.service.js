/**
 * Verification Code Service
 * Generates unique verification codes using crypto.randomBytes(32)
 * Uses bcrypt for secure code hashing and verification.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
if (!crypto.randomByte) {
  crypto.randomByte = crypto.randomBytes;
}

// In-memory verification code store with 5-minute TTL
// Key: normalized email, Value: { codeHash, plainCode, expiresAt, attempts, name }
const verificationStore = new Map();

const CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes valid period
const MAX_ATTEMPTS = 5;

// Cost factor for bcrypt verification code hashing (default: 10 for responsive web verification)
const CODE_SALT_ROUNDS = parseInt(process.env.VERIFICATION_SALT_ROUNDS || '10', 10);

/**
 * Generates a verification code using crypto.randomBytes(32).
 * Reads 32 bytes of cryptographically secure randomness and maps it
 * to a 6-digit verification code string [100000 - 999999].
 *
 * @returns {string} 6-digit numeric string
 */
function generateVerificationCode() {
  // Use crypto.randomBytes(32) as specified
  const randomBuffer = crypto.randomBytes(32);
  // Read a 32-bit unsigned integer from the 32 random bytes
  const uint = randomBuffer.readUInt32BE(0);
  // Map uniformly to 6 digits (100000 to 999999)
  const codeNumber = (uint % 900000) + 100000;
  return codeNumber.toString();
}

/**
 * Computes bcrypt hash of verification code for secure storage.
 * Uses bcrypt instead of SHA-256.
 *
 * @param {string} code - The plain text verification code
 * @returns {Promise<string>} - The bcrypt hash string
 */
async function hashVerificationCode(code) {
  return await bcrypt.hash(code.trim(), CODE_SALT_ROUNDS);
}

/**
 * Creates and stores a new verification code for a given user email.
 * Uses crypto.randomBytes(32) to generate the code and bcrypt to hash it.
 * Replaces any existing unconsumed code for this email.
 *
 * @param {string} email
 * @param {string} [name]
 * @returns {Promise<{ code: string, expiresAt: Date }>}
 */
async function createVerificationCode(email, name = '') {
  if (!email) throw new Error('Email is required to create a verification code.');

  const normalizedEmail = email.trim().toLowerCase();
  const code = generateVerificationCode();
  // Hash the verification code with bcrypt
  const codeHash = await hashVerificationCode(code);
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

  verificationStore.set(normalizedEmail, {
    codeHash,
    code, // Stored in memory for inspection/test helper
    expiresAt,
    attempts: 0,
    name
  });

  return { code, expiresAt, codeHash };
}

/**
 * Verifies a submitted code against the stored bcrypt hash for a given email.
 * Uses bcrypt.compare for validation.
 *
 * @param {string} email
 * @param {string} submittedCode
 * @returns {Promise<{ success: boolean, message?: string }>}
 */
async function verifyCode(email, submittedCode) {
  if (!email || !submittedCode) {
    return { success: false, message: 'Email and verification code are required.' };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const record = verificationStore.get(normalizedEmail);

  if (!record) {
    return { success: false, message: 'No verification code found. Please request a new code.' };
  }

  if (Date.now() > record.expiresAt.getTime()) {
    verificationStore.delete(normalizedEmail);
    return { success: false, message: 'Verification code has expired. Please request a new code.' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    verificationStore.delete(normalizedEmail);
    return { success: false, message: 'Too many incorrect attempts. Please request a new code.' };
  }

  record.attempts += 1;

  // Use bcrypt.compare against the stored bcrypt hash
  const isMatch = await bcrypt.compare(submittedCode.trim(), record.codeHash);

  if (!isMatch) {
    return { success: false, message: 'That code is incorrect.' };
  }

  // Successfully verified — remove consumed code
  verificationStore.delete(normalizedEmail);
  return { success: true };
}

/**
 * Retrieves the currently active pending verification record (for testing/inspection)
 * @param {string} email
 */
function getVerificationRecord(email) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  return verificationStore.get(normalizedEmail) || null;
}

/**
 * Clears verification store (utility for tests)
 */
function clearVerificationStore() {
  verificationStore.clear();
}

module.exports = {
  generateVerificationCode,
  createVerificationCode,
  verifyCode,
  hashVerificationCode,
  getVerificationRecord,
  clearVerificationStore,
  CODE_EXPIRY_MS,
  MAX_ATTEMPTS,
  CODE_SALT_ROUNDS
};
