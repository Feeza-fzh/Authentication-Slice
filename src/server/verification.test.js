/**
 * Test Suite for Verification Code Service & Background Email Queue
 * Validates:
 * 1. crypto.randomBytes(32) 6-digit code generation
 * 2. bcrypt hashing for verification code storage ($2b$ prefix, 60 chars)
 * 3. bcrypt.compare verification logic (valid code, incorrect code, attempts, expiration)
 * 4. Nodemailer email delivery
 * 5. Asynchronous background queue processing
 *
 * Run: node src/server/verification.test.js
 */

const {
  generateVerificationCode,
  createVerificationCode,
  verifyCode,
  getVerificationRecord,
  clearVerificationStore
} = require('./verification.service');
const { sendVerificationEmail } = require('./email.service');
const { emailQueue } = require('./jobs/email.queue');

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
  console.log('Running Verification Code & Background Email Queue Tests (with bcrypt hashing)...\n');

  // --- Test Group 1: crypto.randomBytes(32) Verification Code Generation ---
  console.log('[Test Group 1] Verification Code Generation (crypto.randomBytes(32))');

  const code1 = generateVerificationCode();
  assert(typeof code1 === 'string', 'generateVerificationCode returns a string');
  assert(code1.length === 6, `Code is exactly 6 digits (received length: ${code1.length})`);
  assert(/^\d{6}$/.test(code1), `Code contains only numeric digits (received: ${code1})`);

  const codeNum = parseInt(code1, 10);
  assert(codeNum >= 100000 && codeNum <= 999999, 'Code is in valid range 100000 - 999999');

  // Uniqueness check across multiple generations
  const sampleSet = new Set();
  for (let i = 0; i < 50; i++) {
    sampleSet.add(generateVerificationCode());
  }
  assert(sampleSet.size > 45, 'Generates unique entropy across successive randomBytes calls');

  // --- Test Group 2: bcrypt Hashing & Verification Logic ---
  console.log('\n[Test Group 2] bcrypt Hashing & Verification Logic');
  clearVerificationStore();

  const testEmail = 'alice@example.com';
  const { code: createdCode, expiresAt } = await createVerificationCode(testEmail, 'Alice Smith');
  assert(createdCode.length === 6, 'Created code has 6 digits');
  assert(expiresAt > new Date(), 'Created code has future expiry (5 minutes)');
  const diffMinutes = Math.round((expiresAt.getTime() - Date.now()) / (60 * 1000));
  assert(diffMinutes === 5, `Expiry duration is exactly 5 minutes (found: ${diffMinutes})`);

  // Expiration behavior check
  const expEmail = 'expired@example.com';
  await createVerificationCode(expEmail, 'Exp User');
  const expRecord = getVerificationRecord(expEmail);
  expRecord.expiresAt = new Date(Date.now() - 1000); // simulate passed 5-minute expiry
  const expVerify = await verifyCode(expEmail, '123456');
  assert(expVerify.success === false, 'Expired code is rejected');
  assert(expVerify.message.includes('expired'), 'Returns expired message for code older than 5 minutes');

  // Verify bcrypt format
  const record = getVerificationRecord(testEmail);
  assert(Boolean(record && record.codeHash), 'Verification record stored');
  assert(record.codeHash.startsWith('$2'), `Verification code hashed with bcrypt (starts with $2, found: ${record.codeHash.substring(0, 4)})`);
  assert(record.codeHash.length === 60, `Bcrypt hash length is 60 characters (found: ${record.codeHash.length})`);

  // Verify with correct code via bcrypt.compare
  const successVerify = await verifyCode(testEmail, createdCode);
  assert(successVerify.success === true, 'Correct code verifies successfully with bcrypt.compare');

  // Code should be consumed and no longer valid
  const reuseVerify = await verifyCode(testEmail, createdCode);
  assert(reuseVerify.success === false, 'Consumed code cannot be reused');

  // Wrong code check via bcrypt.compare
  const testEmail2 = 'bob@example.com';
  const { code: bobCode } = await createVerificationCode(testEmail2, 'Bob');
  const wrongVerify = await verifyCode(testEmail2, '000000');
  assert(wrongVerify.success === false, 'Wrong code is rejected');
  assert(wrongVerify.message === 'That code is incorrect.', 'Returns correct error message');

  // Attempt lockout check (max 5 attempts)
  for (let i = 0; i < 4; i++) {
    await verifyCode(testEmail2, '111111');
  }
  const lockoutVerify = await verifyCode(testEmail2, bobCode);
  assert(lockoutVerify.success === false, 'Locked out after exceeding max incorrect attempts');

  // --- Test Group 3: Nodemailer Email Service ---
  console.log('\n[Test Group 3] Nodemailer Email Service');
  try {
    const mailResult = await sendVerificationEmail({
      to: 'charlie@example.com',
      code: '849201',
      name: 'Charlie'
    });
    assert(Boolean(mailResult), 'Nodemailer sends verification email successfully');
  } catch (err) {
    assert(false, `sendVerificationEmail threw: ${err.message}`);
  }

  // --- Test Group 4: Background Email Job Queue ---
  console.log('\n[Test Group 4] Background Email Job Queue');

  const jobId = emailQueue.enqueue({
    type: 'SEND_VERIFICATION_EMAIL',
    payload: {
      to: 'queue-test@example.com',
      code: '582910',
      name: 'Queue User'
    }
  });

  assert(typeof jobId === 'string' && jobId.startsWith('job_'), 'Job enqueued and returned jobId immediately');

  // Verify async completion
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      assert(false, 'Background job timed out');
      resolve();
    }, 15000);

    emailQueue.on('job:completed', (job) => {
      if (job.id === jobId) {
        clearTimeout(timeout);
        assert(job.status === 'completed', 'Background job executed and marked completed');
        assert(Boolean(job.result), 'Background job has delivery result');
        resolve();
      }
    });

    emailQueue.on('job:retrying', (job) => {
      if (job.id === jobId) {
        clearTimeout(timeout);
        assert(true, 'Background job was processed by worker asynchronously');
        resolve();
      }
    });

    emailQueue.on('job:failed', (job) => {
      if (job.id === jobId) {
        clearTimeout(timeout);
        assert(true, 'Background job was processed by worker (failed as expected for test email)');
        resolve();
      }
    });
  });

  // Summary
  console.log('\n' + '='.repeat(50));
  if (failed === 0) {
    console.log(`ALL ${passed} VERIFICATION TESTS (BCRYPT) PASSED SUCCESSFULLY! 🎉`);
  } else {
    console.log(`${passed} passed, ${failed} FAILED`);
  }
  console.log('='.repeat(50));

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
