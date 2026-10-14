/**
 * Automated Test Suite for Forgot Password & Reset Password Flow:
 * 1. Requesting password reset returns a 6-digit verification code.
 * 2. Entering the wrong verification code shows an error message.
 * 3. Entering the correct verification code succeeds.
 * 4. Passwords that do not match show an error prompting user to re-input passwords.
 * 5. Matching passwords update user password and enable signing in with the new password.
 */

const assert = require('assert');
const {
  requestPasswordReset,
  verifyPasswordResetCode,
  resetUserPassword,
  authenticateUser,
  registerUser,
  ValidationError
} = require('../src/server/auth.service');
const { prisma } = require('../src/server/db');

async function runTests() {
  console.log('🧪 Starting Forgot Password Flow Test Suite...\n');

  const testEmail = `forgot_test_${Date.now()}@example.com`;
  const initialPassword = 'InitialPassword1!';
  const newPassword = 'NewSecretPassword1!';

  // Step 0: Ensure user exists in database/system
  console.log('Step 0: Creating test user account...');
  try {
    await registerUser({
      name: 'Test ResetUser',
      email: testEmail,
      password: initialPassword
    });
  } catch (err) {
    console.log('  Notice on registerUser:', err.message);
  }

  // Step 1: Request password reset (verification code sent to email)
  console.log('\nStep 1: Requesting password reset...');
  const resetReq = await requestPasswordReset(testEmail);
  assert(resetReq.success, 'Request password reset must return success');
  assert(resetReq.verificationCode, 'Verification code must be generated');
  assert.strictEqual(resetReq.verificationCode.length, 6, 'Verification code must be exactly 6 digits');
  assert(/^\d{6}$/.test(resetReq.verificationCode), 'Verification code must be numeric');
  const code = resetReq.verificationCode;
  console.log(`  ✅ 6-digit verification code generated and sent: ${code}`);

  // Step 2: Verify wrong code
  console.log('\nStep 2: Testing incorrect verification code...');
  try {
    await verifyPasswordResetCode(testEmail, '000000');
    assert.fail('Incorrect code should throw ValidationError');
  } catch (err) {
    assert(err instanceof ValidationError, 'Must throw ValidationError');
    assert(
      err.message.includes('incorrect') || err.message.includes('expired'),
      `Error message should indicate incorrect code, got: "${err.message}"`
    );
    console.log(`  ✅ Correctly rejected wrong code with error: "${err.message}"`);
  }

  // Step 3: Verify correct code
  console.log('\nStep 3: Testing correct verification code...');
  const verifyRes = await verifyPasswordResetCode(testEmail, code);
  assert(verifyRes.success, 'Correct code must verify successfully');
  console.log('  ✅ Correct verification code accepted successfully');

  // Step 4: Test password mismatch
  console.log('\nStep 4: Testing mismatched passwords...');
  try {
    await resetUserPassword({
      email: testEmail,
      code,
      newPassword: 'MyNewPassword1',
      confirmPassword: 'DifferentPassword2'
    });
    assert.fail('Mismatched passwords must throw ValidationError');
  } catch (err) {
    assert(err instanceof ValidationError, 'Must throw ValidationError');
    assert(
      err.message.includes('do not match'),
      `Error message must prompt user to re-input passwords, got: "${err.message}"`
    );
    console.log(`  ✅ Correctly caught password mismatch: "${err.message}"`);
  }

  // Step 5: Test matching passwords update
  console.log('\nStep 5: Resetting password with matching valid passwords...');
  const resetRes = await resetUserPassword({
    email: testEmail,
    code,
    newPassword,
    confirmPassword: newPassword
  });
  assert(resetRes.success, 'Password reset must succeed');
  console.log('  ✅ Password reset successful');

  // Step 6: Verify sign-in with newly created password
  console.log('\nStep 6: Signing in with newly created password...');
  const authRes = await authenticateUser(testEmail, newPassword, '127.0.0.1');
  assert(authRes && authRes.user, 'Must authenticate with new password');
  console.log(`  ✅ Successfully signed in as ${authRes.user.email} with newly created password!`);

  // Step 7: Confirm old password is now invalid
  console.log('\nStep 7: Confirming old password is no longer accepted...');
  try {
    await authenticateUser(testEmail, initialPassword, '127.0.0.1');
    assert.fail('Old password should be rejected');
  } catch (err) {
    assert.strictEqual(err.message, 'Invalid email or password.');
    console.log('  ✅ Old password correctly rejected with vague error message');
  }

  console.log('\n======================================================');
  console.log('🎉 ALL FORGOT PASSWORD FLOW TESTS PASSED SUCCESSFULLY!');
  console.log('======================================================\n');
}

runTests().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
