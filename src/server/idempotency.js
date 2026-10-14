/**
 * Idempotency and Race-Condition Protection Manager
 *
 * Provides:
 * 1. In-flight request deduplication (Single Flight / Mutex):
 *    If multiple identical signup requests arrive at the same millisecond (e.g. repeated clicks or multiple tabs),
 *    only ONE request executes. All concurrent requests await the identical in-flight promise.
 * 2. Idempotent result caching:
 *    Completed signup results are cached by Idempotency Key and normalized email for 5 minutes.
 *    Subsequent duplicate requests receive the original successful response without re-processing.
 * 3. Prevents redundant expensive password hashing (bcrypt cost factor 15) and duplicate database operations.
 */

class IdempotencyStore {
  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
    // Cache for completed responses: key -> { result, expiresAt }
    this.cache = new Map();
    // Map of currently executing promises: key -> Promise<any>
    this.inFlight = new Map();
  }

  /**
   * Generates a deduplication key from idempotencyKey or normalized email
   * @param {string} [idempotencyKey]
   * @param {string} emailNormalized
   * @returns {string}
   */
  getKey(idempotencyKey, emailNormalized) {
    if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim().length > 0) {
      return `key:${idempotencyKey.trim()}`;
    }
    return `email:${emailNormalized.trim().toLowerCase()}`;
  }

  /**
   * Retrieves a cached completed response if still valid
   * @param {string} key
   * @returns {object|null}
   */
  getCached(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.result;
  }

  /**
   * Checks if an identical request is currently processing
   * @param {string} key
   * @returns {Promise<any>|null}
   */
  getInFlight(key) {
    return this.inFlight.get(key) || null;
  }

  /**
   * Runs an operation with idempotency and single-flight execution
   *
   * @param {string} key - Primary cache key (e.g. Idempotency Key)
   * @param {string} emailKey - Secondary key (emailNormalized)
   * @param {Function} executeFn - Async operation to execute if not already in-flight or cached
   * @returns {Promise<object>}
   */
  async runIdempotent(key, emailKey, executeFn) {
    // 1. Check cache first for completed responses
    const cachedPrimary = this.getCached(key);
    if (cachedPrimary) {
      console.log(`⚡ [Idempotency] Returning cached response for primary key: ${key}`);
      return { ...cachedPrimary, isIdempotentReplay: true };
    }

    const cachedSecondary = emailKey ? this.getCached(emailKey) : null;
    if (cachedSecondary) {
      console.log(`⚡ [Idempotency] Returning cached response for email key: ${emailKey}`);
      return { ...cachedSecondary, isIdempotentReplay: true };
    }

    // 2. Check for currently in-flight requests (race condition protection)
    const activeFlight = this.getInFlight(key) || (emailKey ? this.getInFlight(emailKey) : null);
    if (activeFlight) {
      console.log(`🛡️ [Race Protection] Identical request already in-flight for ${key}. Joining active promise.`);
      const result = await activeFlight;
      return { ...result, isIdempotentReplay: true };
    }

    // 3. Initiate single-flight execution
    const executionPromise = (async () => {
      try {
        const result = await executeFn();

        // Cache the successful result
        const expiresAt = Date.now() + this.ttlMs;
        this.cache.set(key, { result, expiresAt });
        if (emailKey) {
          this.cache.set(emailKey, { result, expiresAt });
        }

        return result;
      } finally {
        // Clean up in-flight tracking once complete
        this.inFlight.delete(key);
        if (emailKey) {
          this.inFlight.delete(emailKey);
        }
      }
    })();

    // Register active promise under both keys
    this.inFlight.set(key, executionPromise);
    if (emailKey) {
      this.inFlight.set(emailKey, executionPromise);
    }

    return await executionPromise;
  }

  /**
   * Invalidate a key manually (e.g. when verification completes)
   * @param {string} key
   */
  invalidate(key) {
    this.cache.delete(key);
    this.inFlight.delete(key);
  }

  /**
   * Clears all cache and in-flight states (for test resets)
   */
  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }
}

// Global singleton instance
const signupIdempotency = new IdempotencyStore();

module.exports = {
  IdempotencyStore,
  signupIdempotency
};
