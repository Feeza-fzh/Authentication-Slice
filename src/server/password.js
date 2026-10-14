/**
 * Password Hashing Utility
 * Uses bcrypt with a cost factor of 15 for secure password storage.
 *
 * Usage:
 *   const { hashPassword, verifyPassword } = require('./password');
 *
 *   // During registration or password reset — hash before storing
 *   const hash = await hashPassword('userPlainTextPassword');
 *
 *   // During sign-in — compare submitted password against stored hash
 *   const isMatch = await verifyPassword('userPlainTextPassword', storedHash);
 */

const bcrypt = require('bcrypt');

// Cost factor of 15: ~2^15 = 32,768 iterations
// Higher cost = slower hashing = more brute-force resistant
// Cost 15 takes roughly 1-3 seconds per hash on modern hardware
const SALT_ROUNDS = 15;

/**
 * Hash a plain text password using bcrypt.
 * Generates a unique salt automatically per hash.
 *
 * @param {string} plainPassword - The user's plain text password
 * @returns {Promise<string>} - The bcrypt hash string (includes salt + algorithm metadata)
 */
async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  return hash;
}

/**
 * Verify a plain text password against a stored bcrypt hash.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param {string} plainPassword - The user's submitted plain text password
 * @param {string} storedHash - The bcrypt hash retrieved from the database (User.passwordHash)
 * @returns {Promise<boolean>} - true if the password matches, false otherwise
 */
async function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    return false;
  }
  if (!storedHash || typeof storedHash !== 'string') {
    return false;
  }
  const isMatch = await bcrypt.compare(plainPassword, storedHash);
  return isMatch;
}

module.exports = {
  hashPassword,
  verifyPassword,
  SALT_ROUNDS
};
