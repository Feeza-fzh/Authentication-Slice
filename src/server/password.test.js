/**
 * Test suite for bcrypt password hashing utility.
 * Validates hashPassword and verifyPassword with cost factor 15.
 *
 * Run: node src/server/password.test.js
 */

const { hashPassword, verifyPassword, SALT_ROUNDS } = require('./password');

async function runTests() {
  console.log('Running Password Hashing Tests (bcrypt, cost factor 15)...\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✓ ${testName}`);
      passed++;
    } else {
      console.log(`  ✗ ${testName}`);
      failed++;
    }
  }

  // Test 1: SALT_ROUNDS is 15
  assert(SALT_ROUNDS === 15, 'SALT_ROUNDS is set to 15');

  // Test 2: hashPassword returns a bcrypt hash string
  const hash = await hashPassword('TestPassword1!');
  assert(typeof hash === 'string', 'hashPassword returns a string');
  assert(hash.startsWith('$2'), 'Hash starts with bcrypt identifier ($2)');
  assert(hash.length === 60, 'Hash is 60 characters (standard bcrypt length)');

  // Test 3: Hash contains the correct cost factor
  // bcrypt hash format: $2b$15$...
  const costInHash = hash.split('$')[2];
  assert(costInHash === '15', `Hash encodes cost factor 15 (found: ${costInHash})`);

  // Test 4: Correct password verifies successfully
  const validMatch = await verifyPassword('TestPassword1!', hash);
  assert(validMatch === true, 'Correct password returns true');

  // Test 5: Wrong password does not verify
  const invalidMatch = await verifyPassword('WrongPassword99!', hash);
  assert(invalidMatch === false, 'Wrong password returns false');

  // Test 6: Each hash is unique (different salts)
  const hash2 = await hashPassword('TestPassword1!');
  assert(hash !== hash2, 'Same password produces different hashes (unique salts)');

  // Test 7: Both hashes still verify the same password
  const verify1 = await verifyPassword('TestPassword1!', hash);
  const verify2 = await verifyPassword('TestPassword1!', hash2);
  assert(verify1 && verify2, 'Both unique hashes verify the same password');

  // Test 8: Empty/invalid input handling
  let threwForEmpty = false;
  try {
    await hashPassword('');
  } catch (e) {
    threwForEmpty = true;
  }
  assert(threwForEmpty, 'hashPassword throws for empty string');

  const emptyVerify = await verifyPassword('', hash);
  assert(emptyVerify === false, 'verifyPassword returns false for empty password');

  const nullVerify = await verifyPassword(null, hash);
  assert(nullVerify === false, 'verifyPassword returns false for null password');

  const noHashVerify = await verifyPassword('TestPassword1!', null);
  assert(noHashVerify === false, 'verifyPassword returns false for null hash');

  // Summary
  console.log(`\n${'='.length > 0 ? '='.repeat(50) : ''}`);
  if (failed === 0) {
    console.log(`ALL ${passed} TESTS PASSED SUCCESSFULLY! 🎉`);
  } else {
    console.log(`${passed} passed, ${failed} FAILED`);
  }
  console.log('='.repeat(50));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
