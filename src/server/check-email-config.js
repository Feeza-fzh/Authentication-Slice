/**
 * SMTP Diagnostic Tool
 * Run: node src/server/check-email-config.js
 *
 * Tests your SMTP configuration in .env and reports connection status.
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

async function diagnoseSmtp() {
  console.log('==================================================');
  console.log('   EMAIL SERVICE & SMTP DIAGNOSTIC TOOL');
  console.log('==================================================\n');

  const host = process.env.SMTP_HOST || 'Not set';
  const port = process.env.SMTP_PORT || 'Not set';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.EMAIL_FROM || 'Not set';

  console.log('Current .env Settings:');
  console.log(`  SMTP_HOST: ${host}`);
  console.log(`  SMTP_PORT: ${port}`);
  console.log(`  SMTP_USER: ${user || '(empty)'}`);
  console.log(`  SMTP_PASS: ${pass ? '•••••••••••••••• (' + pass.length + ' chars)' : '(empty)'}`);
  console.log(`  EMAIL_FROM: ${from}\n`);

  if (!user || user === 'your-email@gmail.com') {
    console.error('❌ PROBLEM: SMTP_USER is still set to placeholder "your-email@gmail.com"');
    console.error('👉 Fix: Put your actual email address in .env (e.g. SMTP_USER="yourname@gmail.com")\n');
    return;
  }

  if (!pass || pass === 'your-16-char-app-password') {
    console.error('❌ PROBLEM: SMTP_PASS is still set to placeholder "your-16-char-app-password"');
    console.error('👉 Fix: Generate a 16-character App Password from Google and place it in .env\n');
    return;
  }

  console.log('Testing SMTP connection with ' + host + ':' + port + '...');

  const transporter = nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: parseInt(port, 10) === 465,
    auth: { user, pass }
  });

  try {
    await transporter.verify();
    console.log('✅ SUCCESS! Authenticated with ' + host + ' successfully.\n');

    console.log(`Sending a test email to ${user}...`);
    const info = await transporter.sendMail({
      from: `"Auth Test" <${from}>`,
      to: user,
      subject: 'Test Verification Email',
      text: 'If you see this email, your Nodemailer email service is working perfectly!',
      html: '<h3>Success!</h3><p>Your Nodemailer email service is configured correctly and sending emails.</p>'
    });

    console.log(`🎉 TEST EMAIL SENT! Message ID: ${info.messageId}`);
    console.log(`Check your inbox at ${user} (and your Spam folder).\n`);
  } catch (err) {
    console.error('❌ SMTP CONNECTION FAILED:');
    console.error('   ' + err.message + '\n');

    if (err.message.includes('535') || err.message.includes('BadCredentials') || err.message.includes('Username and Password not accepted')) {
      console.log('👉 GOOGLE REJECTION REASON:');
      console.log('   Google rejected the username or app password.');
      console.log('   Common causes:');
      console.log('   1. The 16-character App Password has a typo, extra space, or expired.');
      console.log('   2. The App Password was created under a different Google account than SMTP_USER.');
      console.log('   3. 2-Step Verification is turned off on your Google account.');
      console.log('   To fix: Visit https://myaccount.google.com/apppasswords, create a new App Password, and copy it into .env.');
    }
  }
}

diagnoseSmtp();
