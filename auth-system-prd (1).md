# PRD: Authentication System

## 1. Summary
This product is a standalone authentication system with six screens: create account, sign in, forgot password, reset password, email verification, and a placeholder dashboard. It is done when a new user can sign up, verify their email, reach the dashboard, sign out, and later sign in or reset a forgotten password. The dashboard shows the user's name and a sign out button, and nothing else.

## 2. Tech stack (locked)

The stack is fixed. Do not add a frontend framework, a different ORM, or a different database.

- **Frontend:** Plain HTML and CSS. No React, Vue, or any other JS framework. Screens are server-rendered pages with standard HTML forms. JavaScript is allowed only for the small behaviors the screens require (password show/hide toggle, resend countdown, code input formatting) and must be plain JS, not a framework.
- **Data access:** Prisma ORM. All reads and writes to the database go through Prisma. No raw SQL except inside a Prisma migration where Prisma itself generates it.
- **Database:** PostgreSQL. No other database engine, no in-memory fallback, no SQLite for "local dev convenience."
- **Backend runtime:** Not specified by the person who wrote the input. Prisma requires Node.js, so the backend runs on Node.js (current LTS) with TypeScript. [ASSUMPTION] This is an open question if a different runtime was intended; see section 14.
- **Rendering model:** Server-rendered pages, not a single-page app. This resolves the open question from the previous draft about SPA vs. server-rendered pages: the HTML/CSS-only frontend means server-rendered. [ASSUMPTION]

## 3. Goals and non-goals

**Goals**
- Let a new user create an account, verify their email, and reach the dashboard.
- Let a returning user sign in.
- Let a user reset a forgotten password and sign in with the new one.
- Block the dashboard for signed-out users.
- End sessions on sign out, on the server and on the client.

**Non-goals**
- Landing page or any marketing page.
- Dashboard features of any kind.
- Profile editing.
- Settings.
- Social sign-in.
- Two-factor authentication.
- "Remember me" option, password change while signed in, account deletion, email change, admin tools, and localization. [ASSUMPTION]

## 4. Users and states

| State | Definition | Screens it can reach |
|---|---|---|
| New | No account exists | Create account, Sign in, Forgot password, Reset password (with a valid link) |
| Unverified | Account exists, email not verified | Email verification only. Any other route redirects to Email verification. |
| Verified, signed out | Verified account, no session | Sign in, Forgot password, Reset password, Create account |
| Signed in | Verified account, active session | Dashboard only. Create account, Sign in, Forgot password, Reset password, and Email verification redirect to Dashboard. [ASSUMPTION] |
| Locked out | 5 failed sign-ins in 15 minutes | Sign in (shows lockout message), Forgot password |

Routes: `/sign-up`, `/sign-in`, `/forgot-password`, `/reset-password`, `/verify-email`, `/dashboard`. [ASSUMPTION]

## 5. User flows

**Flow A: New user reaches the dashboard**
1. User opens Create account and submits name, email, and password.
2. System creates an unverified account, sends a 6-digit code, and opens a verification-only session.
3. System shows Email verification.
4. User enters the code.
5. System marks the email verified, upgrades the session to a full session, and shows Dashboard.

Failure paths:
- Invalid field: inline error, no account created.
- Wrong code: error shown, attempt count rises. After 5 wrong attempts the code is void and the user must resend.
- Expired code: error shown, user taps Resend.
- Email already registered: see FR-05 and the edge case table.

**Flow B: Returning user signs in**
1. User opens Sign in and submits email and password.
2. System checks credentials and the lockout state.
3. System creates a session and shows Dashboard.

Failure paths:
- Wrong email or password: generic error, failed count rises.
- Account locked: lockout message.
- Account unverified with correct password: system sends a new code and shows Email verification.

**Flow C: Forgotten password**
1. User opens Forgot password and submits their email.
2. System shows the same confirmation whether or not the email exists.
3. If the account exists, system emails a reset link.
4. User opens the link and submits a new password twice.
5. System saves the password, ends all sessions for that user, and shows Sign in with a success message.
6. User signs in with the new password.

Failure paths:
- Link expired, used, or invalid: Reset password shows an error with a link to Forgot password.
- New password fails validation: inline error, token stays valid.

**Flow D: Direct dashboard access while signed out**
1. User types the dashboard URL.
2. System finds no valid session.
3. System redirects to Sign in.

Failure path: Session expired. Same redirect, with the message "Your session has expired. Sign in again."

**Flow E: Sign out**
1. Signed-in user presses Sign out.
2. System revokes the session on the server, clears the cookie, and shows Sign in.
3. Back button shows Sign in, not the dashboard.

Failure path: Network error on the request. Client clears the cookie anyway and shows Sign in. The server session expires on its own schedule. [ASSUMPTION]

## 6. Screen specifications

### 6.1 Create account
**Purpose:** Collect the details needed to make an account.

| Control | Type | Label | Placeholder | Required |
|---|---|---|---|---|
| Name | text | Full name | Your full name | Yes |
| Email | email | Email address | you@example.com | Yes |
| Password | password, with show/hide toggle | Password | At least 10 characters | Yes |
| Submit | button | Create account | none | n/a |
| Link | text link | Already have an account? Sign in | none | n/a |

**Validation**
- Name: 1 to 80 characters after trimming.
- Email: valid format, 254 characters max. System trims and lowercases it.
- Password: 10 to 128 characters, at least one letter and one number. All characters allowed, including spaces.

**Error messages**
- Empty name: "Enter your name."
- Name too long: "Name must be 80 characters or fewer."
- Empty or invalid email: "Enter a valid email address."
- Password too short: "Password must be at least 10 characters."
- Password missing letter or number: "Password must include at least one letter and one number."
- Password too long: "Password must be 128 characters or fewer."
- Rate limit hit: "Too many attempts. Try again in a few minutes."

**Success:** Go to Email verification.
**States:**
- Empty: all fields blank, submit enabled.
- Loading: submit disabled, label "Creating account...".
- Disabled: fields locked during submit.

**Accessibility:**
- Tab order: Name, Email, Password, show/hide toggle, Submit, Sign in link.
- Every field has a visible label tied by `for`/`id`.
- Errors show under their field and are linked with `aria-describedby`.
- On submit failure, focus moves to the first invalid field.
- Errors are announced via `aria-live="polite"`.

### 6.2 Sign in
**Purpose:** Let a verified user start a session.

| Control | Type | Label | Placeholder | Required |
|---|---|---|---|---|
| Email | email | Email address | you@example.com | Yes |
| Password | password, with show/hide toggle | Password | Your password | Yes |
| Submit | button | Sign in | none | n/a |
| Link | text link | Forgot password? | none | n/a |
| Link | text link | Create account | none | n/a |

**Validation:** Email format check and non-empty password only. No password rules apply here.

**Error messages**
- Empty or invalid email: "Enter a valid email address."
- Empty password: "Enter your password."
- Wrong credentials or unknown email: "Email or password is incorrect."
- Locked: "Too many attempts. Try again in 15 minutes."
- Rate limit hit: "Too many attempts. Try again in a few minutes."

**Success:** Go to Dashboard. Unverified users go to Email verification.
**States:**
- Empty: blank fields.
- Loading: submit disabled, label "Signing in...".
- Disabled: submit disabled while any field is empty.

**Accessibility:** Same rules as 6.1. Tab order: Email, Password, toggle, Submit, Forgot password link, Create account link.

### 6.3 Forgot password
**Purpose:** Let a user request a reset email.

| Control | Type | Label | Placeholder | Required |
|---|---|---|---|---|
| Email | email | Email address | you@example.com | Yes |
| Submit | button | Send reset link | none | n/a |
| Link | text link | Back to sign in | none | n/a |

**Validation:** Valid email format, 254 characters max.

**Error messages**
- Empty or invalid email: "Enter a valid email address."
- Rate limit hit: "Too many attempts. Try again in a few minutes."

**Success:** The form is replaced by this text: "If an account exists for that email, we sent a reset link. The link expires in 30 minutes." This text appears for every valid email.
**States:**
- Empty: blank field.
- Loading: submit disabled, label "Sending...".
- Disabled: submit disabled while the field is empty.

**Accessibility:** Success text receives focus and is announced. Tab order: Email, Submit, Back link.

### 6.4 Reset password
**Purpose:** Let a user set a new password using the emailed link.

| Control | Type | Label | Placeholder | Required |
|---|---|---|---|---|
| New password | password, with show/hide toggle | New password | At least 10 characters | Yes |
| Confirm password | password | Confirm new password | Repeat your password | Yes |
| Submit | button | Reset password | none | n/a |

**Validation:** Password rules match 6.1. Both fields must match.

**Error messages**
- Password rule failures: same wording as 6.1.
- Mismatch: "Passwords do not match."
- Invalid, expired, or used link: "This reset link is invalid or has expired. Request a new one." Includes a link to Forgot password. The form is hidden.
- Rate limit hit: "Too many attempts. Try again in a few minutes."

**Success:** Go to Sign in with the message "Password updated. Sign in with your new password."
**States:**
- Empty: blank fields.
- Loading: submit disabled, label "Saving...".
- Disabled: fields hidden if the link is invalid.
- On load, the system checks the token without using it.

**Accessibility:** Tab order: New password, toggle, Confirm password, Submit. Errors follow the rules in 6.1.

### 6.5 Email verification
**Purpose:** Confirm the user owns the email address.

| Control | Type | Label | Placeholder | Required |
|---|---|---|---|---|
| Code | numeric text, `inputmode="numeric"`, `autocomplete="one-time-code"` | Verification code | 6-digit code | Yes |
| Submit | button | Verify email | none | n/a |
| Resend | button | Resend code | none | n/a |
| Sign out | text link | Use a different account | none | n/a |

The screen shows: "We sent a 6-digit code to [email]. The code expires in 10 minutes."

**Validation:** Exactly 6 digits. System strips spaces.

**Error messages**
- Empty or not 6 digits: "Enter the 6-digit code."
- Wrong code: "That code is incorrect."
- Expired code: "That code has expired. Request a new one."
- Too many wrong attempts: "Too many incorrect codes. Request a new one."
- Resend cooldown: "Wait [n] seconds before requesting another code."
- Resend limit: "You have reached the resend limit. Try again in 1 hour."

**Success:** Go to Dashboard. Resend success text: "We sent a new code."
**States:**
- Empty: blank field. Resend disabled for the first 60 seconds after any code is sent, with a visible countdown.
- Loading: submit disabled, label "Verifying...".
- Disabled: submit disabled until 6 digits are entered.

**Accessibility:**
- Tab order: Code, Submit, Resend, Different account link.
- Countdown text is not announced every second. It announces once when Resend becomes available.
- Resend result is announced via `aria-live="polite"`.

### 6.6 Placeholder dashboard
**Purpose:** Confirm the user is signed in.

Content: one line of text, "Signed in as [name]", and one button labeled "Sign out". Nothing else appears on the page.

**Validation:** None.
**Error messages:** None. If the session is invalid, the user goes to Sign in.
**Success:** Sign out goes to Sign in with the message "You have signed out."
**States:**
- Loading: the page shows nothing until the session check finishes.
- Sign out pressed: button disabled, label "Signing out...".

**Accessibility:** The page has one `h1` holding the line of text. The button is the only focusable element.

## 7. Functional requirements

- **FR-01:** The system shall create an unverified account when a valid name, email, and password are submitted.
- **FR-02:** The system shall store the email trimmed and lowercased, and treat emails as unique on that value.
- **FR-03:** The system shall send a 6-digit numeric verification code to the email on account creation.
- **FR-04:** The system shall expire a verification code 10 minutes after it is sent.
- **FR-05:** When a submitted sign-up email already has an account, the system shall show the same result as a new sign-up and send the "already registered" email described in section 9. [ASSUMPTION]
- **FR-06:** The system shall accept a maximum of 5 wrong attempts per code, then void it.
- **FR-07:** The system shall allow one resend per 60 seconds and 5 resends per hour per account.
- **FR-08:** The system shall void the previous code whenever it issues a new one.
- **FR-09:** The system shall mark the email verified when the correct, unexpired code is submitted.
- **FR-10:** The system shall block unverified accounts from the dashboard.
- **FR-11:** The system shall sign in a verified user when the email and password match.
- **FR-12:** When an unverified user signs in with a correct password, the system shall send a new code and show Email verification. [ASSUMPTION]
- **FR-13:** The system shall create a reset token only when the submitted email has a verified account, and shall show the same confirmation in all cases.
- **FR-14:** The system shall expire a reset token 30 minutes after creation.
- **FR-15:** The system shall accept a reset token once. A used token shall be rejected.
- **FR-16:** The system shall void earlier unused reset tokens when it issues a new one for the same account.
- **FR-17:** The system shall revoke all sessions for a user when their password is reset.
- **FR-18:** The system shall not sign the user in after a password reset. The user goes to Sign in.
- **FR-19:** The system shall create a session with a 256-bit random identifier after successful sign-in or verification.
- **FR-20:** The system shall expire a full session 7 days after creation, with no extension. [ASSUMPTION]
- **FR-21:** The system shall expire a verification-only session 1 hour after creation. That session shall reach only the verification endpoints. [ASSUMPTION]
- **FR-22:** The system shall check the session on every request to the dashboard and redirect to Sign in when it is missing, expired, or revoked.
- **FR-23:** The system shall redirect a signed-in user from Create account, Sign in, Forgot password, Reset password, and Email verification to the dashboard.
- **FR-24:** On sign out, the system shall revoke the session on the server, clear the session cookie, and redirect to Sign in.
- **FR-25:** The system shall send `Cache-Control: no-store` on the dashboard and all auth screens so the back button cannot restore a signed-out view.
- **FR-26:** The dashboard shall recheck the session when its tab regains focus and redirect to Sign in if the session is gone. [ASSUMPTION]

## 8. Security requirements

- **Password storage:** Hash with Argon2id (memory 19 MiB, 2 iterations, 1 thread). Use a unique salt per password. Never store or log plain passwords. [ASSUMPTION]
- **Code and token storage:** Store SHA-256 hashes of verification codes, reset tokens, and session identifiers. Never store the raw value.
- **Entropy:** Verification codes come from a cryptographically secure random source (10^6 possibilities, limited by the 5 attempt cap). Reset tokens and session identifiers use 256 bits.
- **Rate limiting:** 10 requests per minute per IP on each auth endpoint. 5 sign-up attempts per hour per IP. 5 reset requests per hour per email and per IP. [ASSUMPTION]
- **Lockout:** 5 failed sign-ins within 15 minutes locks the email for 15 minutes. The system tracks this by normalized email whether or not the account exists. A successful sign-in resets the count. A password reset clears the lock.
- **Account enumeration:** Sign in returns "Email or password is incorrect." for unknown emails and wrong passwords. Response time must be comparable for both cases. Forgot password and Create account show identical results whether or not the email exists.
- **Session cookie:** `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Cookie name and domain are open questions.
- **CSRF:** Every state-changing request needs a CSRF token, and the server checks the `Origin` header.
- **Transport:** HTTPS only, with HSTS.
- **Reset link:** The link page sets `Referrer-Policy: no-referrer`. The reset token is removed from the browser address bar after load. [ASSUMPTION]
- **Logging:** Auth logs must not contain passwords, codes, or tokens.

## 9. Email specifications

All emails are plain text. Sender name: "[Product Name]". [ASSUMPTION] Product name and sender address are open questions.

**Verification code**
- Subject: "Your verification code: [code]"
- Body:
  - "Hi [name],"
  - "Your verification code is [code]."
  - "It expires in 10 minutes."
  - "If you did not create an account, ignore this email."

**Password reset**
- Subject: "Reset your password"
- Body:
  - "Hi [name],"
  - "Use this link to reset your password: [link]"
  - "The link expires in 30 minutes and works once."
  - "If you did not ask for this, ignore this email. Your password stays the same."

**Already registered** [ASSUMPTION]
- Subject: "You already have an account"
- Body:
  - "Someone tried to create an account with this email address."
  - "You already have an account. Sign in here: [sign-in link]"
  - "If you forgot your password, use the reset link on that page."
  - "If this was not you, ignore this email."

## 10. Data model

The data model is defined as a Prisma schema. This is the only data model. Field names, types, and constraints below are binding; an engineer does not redesign this, only runs `prisma migrate`.

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum SessionType {
  pending_verification
  full
}

model User {
  id               String    @id @default(uuid()) @db.Uuid
  name             String    @db.VarChar(120) // Full name
  firstName        String    @map("first_name") @db.VarChar(50)
  middleName       String?   @map("middle_name") @db.VarChar(50) // Optional middle name for multi-word edge cases (3+ words)
  lastName         String    @map("last_name") @db.VarChar(50)
  email            String    @db.VarChar(254)
  emailNormalized  String    @unique @map("email_normalized") @db.VarChar(254)
  passwordHash     String    @map("password_hash")
  emailVerifiedAt  DateTime? @map("email_verified_at")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")

  verificationCodes EmailVerificationCode[]
  resetTokens       PasswordResetToken[]
  sessions          Session[]

  @@map("users")
}

// Tracks sign-in failures by normalized email, including emails with no
// account, so lockout cannot be used to probe which emails are registered.
model LoginAttempt {
  id               String    @id @default(uuid()) @db.Uuid
  emailNormalized  String    @unique @map("email_normalized") @db.VarChar(254)
  failedCount      Int       @default(0) @map("failed_count")
  windowStartedAt  DateTime  @map("window_started_at")
  lockedUntil      DateTime? @map("locked_until")

  @@map("login_attempts")
}

model EmailVerificationCode {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  codeHash    String    @map("code_hash")
  expiresAt   DateTime  @map("expires_at")
  attempts    Int       @default(0)
  consumedAt  DateTime? @map("consumed_at")
  voidedAt    DateTime? @map("voided_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("email_verification_codes")
}

model PasswordResetToken {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  tokenHash   String    @map("token_hash")
  expiresAt   DateTime  @map("expires_at")
  usedAt      DateTime? @map("used_at")
  voidedAt    DateTime? @map("voided_at")
  createdAt   DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}

model Session {
  id          String      @id @default(uuid()) @db.Uuid
  userId      String      @map("user_id") @db.Uuid
  tokenHash   String      @map("token_hash")
  type        SessionType
  createdAt   DateTime    @default(now()) @map("created_at")
  expiresAt   DateTime    @map("expires_at")
  revokedAt   DateTime?   @map("revoked_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("sessions")
}
```

Notes binding on implementation:
- `codeHash` on `EmailVerificationCode`, `tokenHash` on `PasswordResetToken`, and `tokenHash` on `Session` store SHA-256 hashes only, never the raw value. This is enforced in application code; Prisma has no way to enforce it at the schema level, so a code review check is required (see `auth-tokens-codes.md` and `auth-sessions.md` rule files).
- `LoginAttempt` has no foreign key to `User`, on purpose: it tracks normalized emails whether or not an account exists, which is part of how account enumeration is prevented (see section 8).
- `onDelete: Cascade` on `EmailVerificationCode`, `PasswordResetToken`, and `Session` means deleting a `User` deletes its related rows. There is no user-deletion feature in v1, so this only matters if a row is removed by a future admin tool or a manual operation.
- Table and column names are snake_case in Postgres (via `@map`), field names are camelCase in the Prisma client, which is Prisma's own convention, not a deviation from it.

## 11. Edge cases

| Case | Expected behaviour |
|---|---|
| Unverified user tries to sign in | With the right password, system sends a new code and shows Email verification. With a wrong password, the standard error appears. |
| Expired code | Error "That code has expired. Request a new one." Resend stays available. |
| Expired reset link | Reset password shows the invalid link error and a link to Forgot password. |
| Reused reset link | Same as expired link. |
| Resend spam | Cooldown of 60 seconds. After 5 resends in an hour, resend is blocked for the rest of that hour. |
| Duplicate email at sign up | Same screen as a new sign-up. The existing account gets the "already registered" email. No new account is created. |
| Signed-in user opens the sign in page | Redirect to Dashboard. |
| User signs out in one tab while another tab is open | The other tab redirects to Sign in on its next request or when it regains focus. |
| Wrong code entered repeatedly | After 5 wrong attempts the code is void. User must resend. |
| Sign in during lockout | Lockout message. Correct password does not bypass the lock. |
| User requests reset twice | Only the newest link works. |
| Signed-in user opens a reset link | Redirect to Dashboard. The token stays unused. [ASSUMPTION] |
| Session cookie expires while user is on dashboard | Next request or tab focus redirects to Sign in with the expiry message. |
| Verification-only session tries the dashboard | Redirect to Email verification. |
| Password reset for an unverified account | No reset token is created. The confirmation text still appears. [ASSUMPTION] |

## 12. Acceptance criteria

**New user creates an account, verifies, and reaches the dashboard**
- Given a valid unregistered email, when the user submits Create account, then an unverified account exists, a code is emailed, and Email verification appears.
- Given a correct unexpired code, when the user submits it, then the email is marked verified and Dashboard appears with the user's name.
- Given a wrong code, when the user submits it, then "That code is incorrect." appears and the user stays on the screen.
- Given a code older than 10 minutes, when the user submits it, then the expired error appears.

**Returning user signs in**
- Given a verified account, when the user submits the right email and password, then Dashboard appears.
- Given a wrong password, when the user submits, then "Email or password is incorrect." appears.
- Given 5 failed attempts in 15 minutes, when the user tries again, then the lockout message appears even with the right password.

**User resets a forgotten password**
- Given any valid email, when the user submits Forgot password, then the same confirmation appears.
- Given a verified account, when the user submits Forgot password, then a reset email arrives with a link that works for 30 minutes.
- Given a valid link, when the user submits a valid matching password, then Sign in appears with the success message.
- Given a completed reset, when the user signs in with the new password, then Dashboard appears. The old password fails.
- Given a used or expired link, when the user opens it, then the invalid link error appears.

**Signed-out user opens the dashboard URL**
- Given no session, when the user opens the dashboard URL, then Sign in appears.
- Given an expired session, when the user opens the dashboard URL, then Sign in appears with the expiry message.

**Sign out ends the session**
- Given a signed-in user, when they press Sign out, then Sign in appears with "You have signed out."
- Given a completed sign out, when the user presses Back, then Sign in appears, not the dashboard.
- Given a completed sign out, when a request reuses the old session cookie, then the server rejects it.

## 13. Success metrics

| Metric | Definition | Formula | Target |
|---|---|---|---|
| Sign-up completion rate | Users who submit a valid sign-up form out of users who open Create account | Accounts created / Create account page views | 60% [ASSUMPTION] |
| Email verification completion rate | New accounts verified within 24 hours | Verified within 24h / Accounts created | 85% [ASSUMPTION] |
| Sign-in success rate | Sign-in attempts that create a session | Successful sign-ins / Sign-in submissions | 90% [ASSUMPTION] |
| Password reset completion rate | Reset requests that end in a new password within 30 minutes | Resets completed / Reset emails sent | 70% [ASSUMPTION] |
| Time to dashboard | Median time from Create account submit to Dashboard view | Median of (dashboard view time minus sign-up submit time) | Under 3 minutes [ASSUMPTION] |

## 14. Assumptions and open questions

**Assumptions**

| # | Assumption | Reason | Risk if wrong |
|---|---|---|---|
| 1 | Routes are `/sign-up`, `/sign-in`, `/forgot-password`, `/reset-password`, `/verify-email`, `/dashboard` | Needed to define redirects | Low. Rename later. |
| 2 | Email and password are the only credentials. Sign-up collects a single full name field. | Dashboard must show a name | Medium. Split name fields would change the data model. |
| 3 | Password rules: 10 to 128 characters, one letter, one number | Balance of strength and effort | Low. Rules are config. |
| 4 | Duplicate sign-up shows the same result as a new sign-up, plus an "already registered" email | Prevents account enumeration | Medium. Users may be confused when no code arrives. |
| 5 | Unverified users who sign in get a new code and go to verification | Avoids a dead end | Low. |
| 6 | A verification-only session lasts 1 hour and reaches verification endpoints only | Needed so the code screen knows the user | Medium. Alternative is a signed verification token. |
| 7 | Full sessions last 7 days with no extension and no "remember me" | Simplest rule | Medium. Users may expect longer or sliding sessions. |
| 8 | Signed-in users are redirected away from all auth screens, including reset links | Keeps state clean | Low. |
| 9 | Password reset does not sign the user in | Safer, simpler | Low. |
| 10 | No reset email goes to unverified accounts | Avoids verifying by reset | Low. Unverified users can still sign in and get a new code. |
| 11 | Argon2id parameters, rate limits, and lockout numbers as stated in section 8 | Common defaults | Low. Tune after launch. |
| 12 | Reset token is removed from the address bar after load | Limits leakage | Low. |
| 13 | Dashboard rechecks the session on tab focus | Handles multi-tab sign out | Low. |
| 14 | Network failure on sign out still clears the client and redirects | User intent is clear | Medium. Server session stays alive until expiry. |
| 15 | Metric targets in section 13 | No baseline provided | High. They are placeholders. |
| 16 | English only, no localization | Not in scope | Low. |
| 17 | Excluded extras: "remember me", password change while signed in, account deletion, email change, admin tools | Not in the input | Low. |
| 18 | Sender name is "[Product Name]" | Name not provided | Low. |

**Open questions**
1. What is the product name and sender email address?
2. What is the app domain, and which cookie name and domain should the session use?
3. Which email provider will send messages, and what is the expected delivery time?
4. Should passwords be checked against a breached password list? This is not in v1 unless you say so.
5. Should the session last longer than 7 days, or slide with activity?
6. What sign-up volume do you expect? This affects rate limit numbers.
7. Is Node.js with TypeScript the intended backend runtime, or was a different Prisma-compatible runtime intended? Prisma requires a JavaScript/TypeScript runtime (Node.js, Deno, or Bun); this PRD assumes Node.js LTS. [see assumption, section 2]
