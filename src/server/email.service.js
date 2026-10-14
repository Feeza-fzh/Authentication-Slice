/**
 * Email Service using Nodemailer
 * Handles email delivery for email verification codes and password resets.
 */

require('dotenv').config();
const nodemailer = require('nodemailer');

let transporterInstance = null;
let lastConfigKey = '';

/**
 * Creates and configures the Nodemailer transporter.
 * In development or testing with no live SMTP credentials, uses a JSON / stream transporter
 * so emails can be inspected without requiring an external SMTP server.
 */
function getTransporter() {
  require('dotenv').config();

  const host = (process.env.SMTP_HOST || 'localhost').trim();
  const port = parseInt(process.env.SMTP_PORT || '1025', 10);
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();

  const configKey = `${host}:${port}:${user}:${pass}`;

  if (transporterInstance && lastConfigKey === configKey) {
    return transporterInstance;
  }

  const hasSmtpCreds = Boolean(user && pass);
  const isPlaceholderCreds =
    user === 'your-email@gmail.com' ||
    pass === 'your-16-char-app-password' ||
    user.includes('example.com') ||
    user === 'your_smtp_username';

  if (hasSmtpCreds && !isPlaceholderCreds) {
    transporterInstance = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass
      }
    });
  } else {
    // Development / test fallback transporter (JSON output / local mock transport)
    transporterInstance = nodemailer.createTransport({
      jsonTransport: true
    });
  }

  lastConfigKey = configKey;
  return transporterInstance;
}

/**
 * Sends a verification email containing the 6-digit verification code.
 *
 * @param {object} params
 * @param {string} params.to - Recipient email address
 * @param {string} params.code - The verification code generated via crypto.randomBytes(32)
 * @param {string} [params.name] - User full name
 * @returns {Promise<object>} - Nodemailer send result info
 */
async function sendVerificationEmail({ to, code, name }) {
  if (!to || !code) {
    throw new Error('Recipient email and verification code are required.');
  }

  const transporter = getTransporter();
  const displayName = name ? name.split(' ')[0] : 'there';
  const emailFrom = process.env.EMAIL_FROM || 'noreply@example.com';

  const mailOptions = {
    from: `"Auth System" <${emailFrom}>`,
    to,
    subject: `Your verification code: ${code}`,
    text: `Hello ${displayName},\n\nYour 6-digit email verification code is: ${code}\n\nThis code will expire in 10 minutes. If you did not request this, please ignore this email.\n\nThank you!`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #111827; background-color: #f9fafb; margin: 0; padding: 24px; }
            .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
            h1 { font-size: 20px; font-weight: 700; margin-top: 0; color: #111827; }
            p { margin: 16px 0; color: #4b5563; font-size: 15px; }
            .code-box { background: #f3f4f6; border-radius: 8px; text-align: center; padding: 18px; margin: 24px 0; letter-spacing: 6px; font-size: 32px; font-weight: 700; color: #1f2937; font-family: monospace; }
            .footer { font-size: 13px; color: #9ca3af; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 16px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Verify your email address</h1>
            <p>Hi ${displayName},</p>
            <p>Thank you for creating an account. Please use the following 6-digit verification code to complete your registration:</p>
            <div class="code-box">${code}</div>
            <p>This code will expire in <strong>10 minutes</strong>. If you did not create an account, you can safely disregard this email.</p>
            <div class="footer">
              &copy; Auth System. All rights reserved.
            </div>
          </div>
        </body>
      </html>
    `
  };

  let info;
  try {
    info = await transporter.sendMail(mailOptions);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      const fallback = nodemailer.createTransport({ jsonTransport: true });
      info = await fallback.sendMail(mailOptions);
      info.devWarning = err.message;
    } else {
      throw err;
    }
  }
  return info;
}

module.exports = {
  getTransporter,
  sendVerificationEmail
};
