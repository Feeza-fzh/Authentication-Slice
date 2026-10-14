/**
 * Test Suite for Server-Side Zod Validation
 * Validates sign-up, sign-in, forgot-password, reset-password, and email-verification schemas.
 *
 * Run: node src/server/validation.test.js
 */

const {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  validate,
  formatZodErrors,
  ValidationError,
  parseFullName
} = require('./validation');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  } else {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  }
}

async function runTests() {
  console.log('Running Server-Side Zod Validation Tests...\n');

  // --- 1. Sign Up Validation Tests ---
  console.log('[Test Group 1] Sign Up Schema (Create Account)');
  
  // Valid sign up
  try {
    const valid = validate(signUpSchema, {
      name: 'Jane Doe',
      email: '  Jane.Doe@EXAMPLE.COM  ',
      password: 'SecurePassword1@'
    });
    assert(valid.name === 'Jane Doe', 'Valid name passes and is trimmed');
    assert(valid.email === 'jane.doe@example.com', 'Valid email is trimmed and normalized to lowercase');
    assert(valid.password === 'SecurePassword1@', 'Valid password passes complexity');
  } catch (err) {
    assert(false, `Valid sign up threw unexpectedly: ${err.message}`);
  }

  // Name rejection tests
  try {
    validate(signUpSchema, { name: 'Jane123', email: 'test@example.com', password: 'Password1#' });
    assert(false, 'Should reject numbers in name');
  } catch (err) {
    assert(err.errors.name === 'Full Name Must Use Only Letters', 'Rejects numbers with correct message');
  }

  try {
    validate(signUpSchema, { name: 'SingleName', email: 'test@example.com', password: 'Password1#' });
    assert(false, 'Should reject single word name');
  } catch (err) {
    assert(err.errors.name === 'Please enter atleast two names', 'Rejects single word name');
  }

  try {
    validate(signUpSchema, { name: '', email: 'test@example.com', password: 'Password1#' });
    assert(false, 'Should reject empty name');
  } catch (err) {
    assert(err.errors.name === 'Full name field cannot be empty', 'Rejects empty name');
  }

  // Password complexity tests
  try {
    validate(signUpSchema, { name: 'Jane Doe', email: 'test@example.com', password: 'short' });
    assert(false, 'Should reject password under 8 chars');
  } catch (err) {
    assert(err.errors.password === 'Minimum of 8 character', 'Rejects short password');
  }

  try {
    validate(signUpSchema, { name: 'Jane Doe', email: 'test@example.com', password: 'alllowercasenumber1@' });
    assert(false, 'Should reject password missing uppercase');
  } catch (err) {
    assert(err.errors.password === 'Password must contain an uppercase letter', 'Rejects missing uppercase');
  }

  try {
    validate(signUpSchema, { name: 'Jane Doe', email: 'test@example.com', password: 'ALLUPPERCASENUMBER1@' });
    assert(false, 'Should reject password missing lowercase');
  } catch (err) {
    assert(err.errors.password === 'Password must contain a lowercase letter', 'Rejects missing lowercase');
  }

  try {
    validate(signUpSchema, { name: 'Jane Doe', email: 'test@example.com', password: 'NoSpecialChar1234' });
    assert(false, 'Should reject password missing special char');
  } catch (err) {
    assert(err.errors.password === 'Password must contain a special character(#@>^)', 'Rejects missing special char');
  }

  // --- 2. Sign In Validation Tests ---
  console.log('\n[Test Group 2] Sign In Schema');
  try {
    const valid = validate(signInSchema, {
      email: '  User@Domain.com ',
      password: 'anyPassword'
    });
    assert(valid.email === 'user@domain.com', 'Sign-in normalizes email');
    assert(valid.password === 'anyPassword', 'Sign-in accepts non-empty password without complex rules');
  } catch (err) {
    assert(false, `Valid sign in threw unexpectedly: ${err.message}`);
  }

  try {
    validate(signInSchema, { email: 'invalid-email', password: 'pass' });
    assert(false, 'Should reject invalid email format in sign in');
  } catch (err) {
    assert(err.errors.email === 'Enter a valid email address.', 'Rejects invalid email format');
  }

  try {
    validate(signInSchema, { email: 'user@example.com', password: '' });
    assert(false, 'Should reject empty password in sign in');
  } catch (err) {
    assert(err.errors.password === 'Password field cannot be empty', 'Rejects empty password');
  }

  // --- 3. Forgot Password Validation Tests ---
  console.log('\n[Test Group 3] Forgot Password Schema');
  try {
    const valid = validate(forgotPasswordSchema, { email: 'forgot@example.com' });
    assert(valid.email === 'forgot@example.com', 'Valid email in forgot password passes');
  } catch (err) {
    assert(false, `Valid forgot password threw: ${err.message}`);
  }

  try {
    validate(forgotPasswordSchema, { email: '' });
    assert(false, 'Should reject empty email in forgot password');
  } catch (err) {
    assert(err.errors.email === 'Email address field cannot be empty', 'Rejects empty email');
  }

  // --- 4. Reset Password Validation Tests ---
  console.log('\n[Test Group 4] Reset Password Schema');
  try {
    const valid = validate(resetPasswordSchema, {
      token: 'valid-reset-token-123',
      newPassword: 'NewSecurePassword1',
      confirmPassword: 'NewSecurePassword1'
    });
    assert(valid.newPassword === 'NewSecurePassword1', 'Valid matching passwords pass');
  } catch (err) {
    assert(false, `Valid reset password threw: ${err.message}`);
  }

  try {
    validate(resetPasswordSchema, {
      token: 'valid-token',
      newPassword: 'NewSecurePassword1',
      confirmPassword: 'DifferentPassword2'
    });
    assert(false, 'Should reject mismatched passwords');
  } catch (err) {
    assert(err.errors.confirmPassword === 'Passwords do not match.', 'Rejects mismatched passwords');
  }

  try {
    validate(resetPasswordSchema, {
      token: 'valid-token',
      newPassword: 'short',
      confirmPassword: 'short'
    });
    assert(false, 'Should reject password under 10 chars');
  } catch (err) {
    assert(err.errors.newPassword === 'Password must be at least 10 characters.', 'Rejects password under 10 characters');
  }

  // --- 5. Verify Email Code Validation Tests ---
  console.log('\n[Test Group 5] Verify Email Code Schema');
  try {
    const valid = validate(verifyEmailSchema, {
      email: 'user@example.com',
      code: '123456'
    });
    assert(valid.code === '123456', 'Valid 6-digit code passes');
  } catch (err) {
    assert(false, `Valid verification code threw: ${err.message}`);
  }

  try {
    validate(verifyEmailSchema, { email: 'user@example.com', code: '12345' });
    assert(false, 'Should reject 5-digit code');
  } catch (err) {
    assert(err.errors.code === 'Enter the 6-digit code.', 'Rejects code with less than 6 digits');
  }

  try {
    validate(verifyEmailSchema, { email: 'user@example.com', code: '12345A' });
    assert(false, 'Should reject non-numeric code');
  } catch (err) {
    assert(err.errors.code === 'Enter the 6-digit code.', 'Rejects non-numeric code');
  }

  // --- 6. Helper: parseFullName Tests ---
  console.log('\n[Test Group 6] Name Parsing Utility');
  const twoWords = parseFullName('John Doe');
  assert(twoWords.firstName === 'John' && twoWords.lastName === 'Doe' && twoWords.middleName === null, 'Parses two-word name');
  
  const threeWords = parseFullName('John Phillip Doe');
  assert(threeWords.firstName === 'John' && threeWords.middleName === 'Phillip' && threeWords.lastName === 'Doe', 'Parses three-word name with middle name');

  // Summary
  console.log('\n' + '='.repeat(50));
  if (failed === 0) {
    console.log(`ALL ${passed} VALIDATION TESTS PASSED SUCCESSFULLY! 🎉`);
  } else {
    console.log(`${passed} passed, ${failed} FAILED`);
  }
  console.log('='.repeat(50));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
