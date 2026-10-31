# Authentication Slice Documentation

## Section 1: What This Is

This authentication slice provides a complete, standalone identity and session management system built with Node.js, Express/Connect middleware, Prisma ORM, and PostgreSQL. It delivers six distinct interfaces: user registration with structured name parsing and automatic email normalization, 6-digit email verification processed through an asynchronous background queue and SMTP transporter, secure sign-in protected by constant-time password comparisons and credential-stuffing defenses, a 3-step password reset workflow, stateful session handling utilizing Auth.js-compliant secure HTTP cookies (`authjs.session-token`), and a locked placeholder dashboard that enforces active session authentication and auto-evicts expired or signed-out users. Every state transition—from account creation to verification, session issuance, and server-side revocation—is backed directly by PostgreSQL tables and database-level constraints.

Deliberately excluded from this slice are OAuth/social login providers (such as Google or GitHub SSO), multi-factor authentication (MFA/TOTP), self-serve profile editing, account deletion, user roles and permissions (RBAC), and multi-tenant organization workspaces. These features were excluded by design to focus strictly on hardening core authentication primitives: robust password hashing, rate limiting and credential-stuffing defenses, server-authoritative session lifecycles, and database data integrity. Excluding auxiliary domain features ensures that security invariants and session boundaries remain transparent, verifiable, and free of domain-specific coupling.

---

## Section 2: How To Run It

Follow these numbered steps to go from a fresh clone to a working local instance in under ten minutes.

### 1. Prerequisites and Installation
Ensure you have **Node.js (v18.x or v20.x LTS)** and **npm** installed on your system. Clone the repository, navigate into the project root directory, and install all dependencies:
```bash
npm install
```
*(Note for Windows PowerShell users: If script execution policy blocks `npm`, invoke commands via `npm.cmd` or run PowerShell with `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`)*.

### 2. Configure Environment Variables
Copy the provided `.env.example` file to create a local `.env` file:
```bash
cp .env.example .env
```
Open `.env` and verify the required configuration variables:
- `DATABASE_URL`: Connection string pointing to your PostgreSQL instance (e.g., a local PostgreSQL database or a cloud-hosted serverless database like Neon). Must include PgBouncer pooling parameters if connecting through a transaction pooler.
- `NODE_ENV`: Set to `development` for local testing, or `production` to enforce `Secure` cookie attributes and prefixed cookie names (`__Secure-`, `__Host-`).
- `PORT`: HTTP port for standalone services (default: `3000`).
- `APP_BASE_URL`: Base origin of the client web application (default: `http://localhost:5173`).
- `AUTH_SECRET`: A 32-character or longer cryptographically secure random secret used for session cookie signing and CSRF tokens (generate using `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- `SESSION_SECRET`: Random hex string used for session payload salting.
- `BCRYPT_SALT_ROUNDS`: Cost factor for bcrypt password hashing (defaults to `15` for production-grade resistance; can be set to `10`–`12` for faster local test iterations).
- `SMTP_HOST`: Hostname of the outbound SMTP email server (e.g., `smtp.gmail.com`, `smtp.sendgrid.net`, or `localhost` for Mailpit/Mailhog).
- `SMTP_PORT`: Port for the SMTP server (`465` for SSL, `587` for STARTTLS, or `1025` for local mail catchers).
- `SMTP_USER`: Username or API key for authenticating with the SMTP server.
- `SMTP_PASS`: Application-specific password or secret token for the SMTP server.
- `EMAIL_FROM`: Sender address that will appear in the `From` header of outgoing verification and reset emails (e.g., `noreply@example.com`).

*(Note: In local development without live SMTP credentials, the email service automatically falls back to a stream/JSON transporter, logging the generated verification codes directly to the server terminal).*

### 3. Database Setup and Migration
Generate the Prisma client artifacts and synchronize your PostgreSQL database schema with the data model:
```bash
npm run prisma:generate
npm run prisma:push
```
*(Alternatively, run `npx prisma db push` to push the schema directly to PostgreSQL).*

### 4. Start the Application
Start the integrated Vite development server and API middleware:
```bash
npm run dev
```

### 5. Access the Application
Open your web browser and navigate to:
```
http://localhost:5173/
```
The root path automatically redirects to `http://localhost:5173/sign-in.html`. You can also directly access `http://localhost:5173/sign-up.html` to create a new account.

---

## Section 3: The Flow, Step By Step

### Flow 1: New User Account Creation (Registration)
1. **User Action:** The user navigates to `/sign-up.html` (rendered via `src/pages/signUp.jsx` and `src/components/SignUpForm.jsx`), enters their full name (e.g., "Jane Elizabeth Doe"), email address, and a password complying with complexity rules (minimum 8 characters, at least one uppercase letter, one lowercase letter, and one special character), and clicks **Create account**.
2. **Frontend Transmission:** The frontend performs instant client-side validation, generates an RFC-4122 client idempotency UUID, trims and lowercases the email, and sends an HTTP POST request to `/api/auth/register` (`src/server/api.js`) containing `{ name, email, password, idempotencyKey }` with the `Idempotency-Key` header attached.
3. **Server Processing:** In `src/server/api.js`, the request is routed to `registerUser()` in `src/server/auth.service.js`. The input is authoritatively validated using Zod (`signUpSchema` in `src/server/validation.js`). The full name is parsed into `firstName`, `middleName`, and `lastName` components via `parseFullName()`. The request enters the single-flight idempotency mutex (`src/server/idempotency.js`). The server checks PostgreSQL for existing accounts with that normalized email. It hashes the password using bcrypt with cost factor 15 (`src/server/password.js`), opens an atomic Prisma transaction (`prisma.$transaction`) inserting the record into `users` and creating a 5-minute temporary verification code hashed with bcrypt in `email_verification_codes`. It enqueues an asynchronous email delivery job (`src/server/jobs/email.queue.js`) and returns HTTP 200 with user metadata. The browser stores temporary email context in `sessionStorage` and redirects to `/verify-email.html`.

### Flow 2: Email Verification and Session Activation
1. **User Action:** The user opens `/verify-email.html` (`src/pages/verifyEmail.jsx` and `src/components/VerifyEmailForm.jsx`), reads the prompt displaying their target email, checks their inbox for the 6-digit code, types the digits into the auto-formatted input field, and clicks **Verify email**.
2. **Frontend Transmission:** The frontend validates that exactly 6 numeric digits have been entered and submits an HTTP POST request to `/api/auth/verify-code` with `{ email, code }`.
3. **Server Processing:** Handled in `src/server/api.js` calling `verifyUserEmail()` in `src/server/auth.service.js`. The payload is validated with `verifyEmailSchema`. The server looks up the user in PostgreSQL with their active verification code records. It validates that the code has not expired (`now < expiresAt`) and that failed attempts have not reached the limit (< 5). It compares the submitted code against the stored hash using `bcrypt.compare()`. Upon success, the server updates `User.emailVerifiedAt = new Date()`, deletes the consumed temporary code records from `email_verification_codes`, generates a cryptographically secure 256-bit random session token (`crypto.randomBytes(32)`), inserts a stateful record into the `sessions` table (`type: 'full'`, 30-day TTL), serializes an Auth.js-compliant `authjs.session-token` cookie (`HttpOnly; SameSite=Lax; Path=/`) via `createSessionCookie()` in `src/server/auth-cookies.js`, and returns HTTP 200. The frontend navigates to `/dashboard.html`.

### Flow 3: Accessing the Protected Dashboard
1. **User Action:** The user arrives on `/dashboard.html`.
2. **Frontend Transmission:** Before rendering, the page's inline script immediately dispatches an authenticated HTTP GET request to `/api/auth/session` with `credentials: 'include'`.
3. **Server Processing:** Handled in `src/server/api.js`. The server extracts the `authjs.session-token` cookie via `getSessionTokenFromRequest()` (`src/server/auth-cookies.js`), computes its SHA-256 hash, and queries the `sessions` table via `validateSession()` in `src/server/auth.service.js`. The server confirms the session exists, that `revokedAt` is `null`, and that `now < expiresAt`. If valid, it returns `{ authenticated: true, user: { name, email } }`, and the dashboard updates its single `<h1>` element to display `"Signed in as [name]"`. If the session is missing, revoked, or expired, the server returns `{ authenticated: false, user: null }`, and the dashboard redirects to `/sign-in.html?flash=session_expired`. The page also registers a `document.visibilitychange` listener to repeat this verification whenever the browser tab regains focus.

### Flow 4: Server-Side Logout
1. **User Action:** On `/dashboard.html`, the signed-in user clicks the **Sign out** button.
2. **Frontend Transmission:** The form submit handler prevents default navigation, disables the button, changes the text to "Signing out...", and sends an HTTP POST request to `/api/auth/sign-out` with credentials included.
3. **Server Processing:** Handled in `src/server/api.js` calling `revokeSession()` in `src/server/auth.service.js`. The server extracts the session token from cookies, hashes it with SHA-256, and executes an SQL update on the `sessions` table setting `revokedAt = new Date()`. The response sets `Set-Cookie` headers clearing `authjs.session-token` and `__Secure-authjs.session-token` with `Max-Age=0` and an expired timestamp (`src/server/auth-cookies.js`). The client clears all `sessionStorage` keys and redirects to `/sign-in.html?flash=signed_out`.

### Flow 5: Returning User Sign-In with Security Defenses
1. **User Action:** The user navigates to `/sign-in.html` (`src/pages/signIn.jsx`, `src/components/SignInForm.jsx`). On mount, the component requests a fresh CSRF token from `/api/auth/csrf`. The user enters their email and password and clicks **Sign in**.
2. **Frontend Transmission:** The frontend validates field non-emptiness and submits an HTTP POST request to `/api/auth/sign-in` containing `{ email, password, csrfToken }` accompanied by the `X-CSRF-Token` header.
3. **Server Processing:** Handled in `src/server/api.js`. The server validates the CSRF token against the `authjs.csrf-token` cookie. It extracts the client IP (`getClientIp()`) and invokes `rateLimitService.checkAllowed(emailNormalized, ip)` (`src/server/rate-limit.service.js`). If the IP or account has exceeded failure limits, an HTTP 429 error is thrown immediately. If allowed, `authenticateUser()` in `src/server/auth.service.js` looks up the user by `emailNormalized` in PostgreSQL. If the user does not exist, the server executes a dummy bcrypt comparison against `DUMMY_BCRYPT_HASH` to prevent timing attacks, records a failure, and returns the vague error message `"Invalid email or password."`. If the user exists, `bcrypt.compare()` verifies the password. If incorrect, a failure is recorded against the `(email, IP)` composite and the same vague error is thrown. If credentials match, failures are cleared, a new session is created in the `sessions` table, the session cookie is attached, and HTTP 200 is returned. The user is redirected to `/dashboard.html` (or to `/verify-email.html` if unverified).

### Flow 6: Forgotten Password and Reset
1. **User Action:** The user clicks "Forgot password?" on the sign-in page, landing on `/forgot-password.html` (`src/pages/forgotPassword.jsx` and `src/components/ResetPasswordFlow.jsx`). The user enters their email address and clicks **Send Code**.
2. **Frontend Transmission:** The frontend validates email syntax and sends an HTTP POST request to `/api/auth/forgot-password` with `{ email }`.
3. **Server Processing:** In `src/server/auth.service.js`, `requestPasswordReset()` validates the email. If the account exists, the server marks any earlier unused reset tokens as void (`voidedAt = new Date()`), generates a 6-digit numeric verification code using `crypto.randomBytes(32)` (`src/server/verification.service.js`), computes its SHA-256 hash, and inserts a row into `password_reset_tokens` with a 15-minute expiration. An email containing the code is enqueued via `emailQueue`. The API returns a generic confirmation message regardless of whether the email was registered.
4. **Code Verification & Password Update:** The user enters the 6-digit code on Step 2, which calls `/api/auth/verify-reset-code` to confirm validity. Upon confirmation, Step 3 appears: the user enters and confirms their new password. The frontend validates matching passwords and sends an HTTP POST to `/api/auth/reset-password`. The server validates the match, hashes the new password with bcrypt (cost factor 15), updates `User.passwordHash`, marks the reset token `usedAt = new Date()`, and revokes all active sessions for that user (`revokedAt = new Date()`). The user is redirected to `/sign-in.html?flash=password_updated`.

---

## Section 4: The Data Model

The schema is defined in `prisma/schema.prisma` targeting PostgreSQL.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum SessionType {
  pending_verification
  full
}

model User {
  id               String    @id @default(uuid()) @db.Uuid
  name             String    @db.VarChar(120)
  firstName        String    @map("first_name") @db.VarChar(50)
  middleName       String?   @map("middle_name") @db.VarChar(50)
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

### Table Explanations and Column Decisions

#### 1. Table `users` (`User`)
*Holds registered user identities, structured names, normalized email credentials, and verification status.*
- `id`: `Uuid`, primary key defaulting to `gen_random_uuid()`. Chosen over auto-incrementing integers to prevent sequential ID guessing and account enumeration attacks.
- `name`: `VarChar(120)`, non-nullable. Stores the complete combined full name string. Bounded to 120 characters to accommodate multi-part international names while preventing uncontrolled storage growth.
- `firstName`: `VarChar(50)`, non-nullable. Structured first component of the user's name for personalized UI greeting.
- `middleName`: `VarChar(50)`, nullable (`String?`). Nullable because many users and cultures do not possess a middle name; accommodates 3+ word name inputs cleanly.
- `lastName`: `VarChar(50)`, non-nullable. Structured surname component for formal communications.
- `email`: `VarChar(254)`, non-nullable. Retains original user casing for display; bounded to RFC 5321 maximum email length (254 octets).
- `emailNormalized`: `VarChar(254)`, unique and non-nullable. Canonical lowercase and trimmed email representation ensuring uniqueness across all lookups.
- `passwordHash`: `String`, non-nullable. Stores the 60-character bcrypt hash string (salt + cost factor + digest). Never nullable so passwordless ghost accounts cannot exist.
- `emailVerifiedAt`: `DateTime`, nullable. `null` explicitly designates an unverified account; storing a timestamp rather than a boolean preserves auditing history of when verification occurred.
- `createdAt` / `updatedAt`: Non-nullable timestamps for auditing and row lifecycles.

#### 2. Table `login_attempts` (`LoginAttempt`)
*Tracks sign-in failure counts and lockout timestamps by normalized email across all client IPs.*
- `id`: `Uuid`, primary key.
- `emailNormalized`: `VarChar(254)`, unique and non-nullable. Intentionally has **no foreign key** to `users`. This ensures failed login attempts against non-existent emails are recorded identically to existing accounts, preventing attackers from probing which emails exist based on lockout behavior.
- `failedCount`: `Int`, default 0. Tracks consecutive failures within the sliding window.
- `windowStartedAt`: `DateTime`, non-nullable. Marks the beginning of the 15-minute sliding rate-limit window.
- `lockedUntil`: `DateTime`, nullable. When populated, locks the account from all sign-in attempts until this timestamp has passed.

#### 3. Table `email_verification_codes` (`EmailVerificationCode`)
*Holds temporary, hashed 6-digit one-time codes for verifying email ownership.*
- `id`: `Uuid`, primary key.
- `userId`: `Uuid`, foreign key referencing `User.id` with `onDelete: Cascade`. Automatically purges codes if the parent user row is deleted.
- `codeHash`: `String`, non-nullable. Stores the bcrypt hash of the verification code. Raw codes are never stored in plaintext in the database.
- `expiresAt`: `DateTime`, non-nullable. Hard 5-minute expiration deadline.
- `attempts`: `Int`, default 0. Incremented on every incorrect guess; once attempts hit 5, the code is invalidated.
- `consumedAt` / `voidedAt`: `DateTime`, nullable audit timestamps recording when the code was verified or superseded by a resend.

#### 4. Table `password_reset_tokens` (`PasswordResetToken`)
*Holds cryptographically hashed one-time tokens and codes issued for password reset requests.*
- `id`: `Uuid`, primary key.
- `userId`: `Uuid`, foreign key referencing `User.id` with `onDelete: Cascade`.
- `tokenHash`: `String`, non-nullable. Stores the SHA-256 hash of the verification token/code.
- `expiresAt`: `DateTime`, non-nullable. Enforces a strict 15-to-30 minute expiration window.
- `usedAt`: `DateTime`, nullable. Timestamp marked upon successful password reset, permanently preventing token reuse.
- `voidedAt`: `DateTime`, nullable. Timestamp marked when a newer reset request supersedes this token.

#### 5. Table `sessions` (`Session`)
*Maintains active and historical server-side authentication sessions.*
- `id`: `Uuid`, primary key.
- `userId`: `Uuid`, foreign key referencing `User.id` with `onDelete: Cascade`.
- `tokenHash`: `String`, non-nullable. Stores the SHA-256 hash of the 256-bit cookie session token. If the database is compromised, the attacker gains useless hashes and cannot forge browser session cookies.
- `type`: `SessionType` enum (`pending_verification`, `full`). Enforces at the database level that unverified accounts cannot hold a `full` session.
- `expiresAt`: `DateTime`, non-nullable. Absolute expiration date (30 days for full sessions).
- `revokedAt`: `DateTime`, nullable. Populated immediately during server-side logout or password reset, revoking the session in milliseconds.

### Which Constraints Make an Invalid State Impossible?

1. **`User.emailNormalized` UNIQUE Constraint:** Prevents duplicate accounts from ever existing. Even if two identical registration requests execute concurrently and both pass application-level pre-checks, the database engine enforces serialization at the index level, rejecting the second insert with error `P2002`.
2. **`LoginAttempt.emailNormalized` UNIQUE Constraint:** Prevents race conditions from creating multiple tracking rows for the same email, ensuring failure counters increment atomically and lockouts cannot be bypassed.
3. **Foreign Keys with `onDelete: Cascade` on `userId` (`sessions`, `email_verification_codes`, `password_reset_tokens`):** Guarantees referential integrity. It is physically impossible to have orphaned verification codes, floating reset tokens, or dangling sessions pointing to a deleted or non-existent user.
4. **Non-Nullable `passwordHash` on `User`:** Guarantees that a user row can never be created without an accompanying password hash, eliminating unauthenticated or passwordless ghost states.
5. **`SessionType` Enum on `Session.type`:** Restricts session privilege levels to exact enumerated values (`pending_verification`, `full`), preventing malformed string injections from granting unauthorized dashboard access.
6. **Nullable `usedAt` and `voidedAt` on `PasswordResetToken`:** Enables atomic state transitions (`WHERE usedAt IS NULL AND voidedAt IS NULL`). Once updated, the database guarantees that token replay or double-spending is impossible.

---

## Section 5: The Concepts

### Password Hashing

#### What it is
Password hashing is a one-way cryptographic transformation that converts a plaintext password into an irreversible, fixed-length character string combined with a cryptographically unique salt. When a user authenticates, the system runs what they typed through the same algorithm with the stored salt and compares the resulting digest against the stored hash. The plaintext password is never retained in memory longer than necessary and is never written to disk or logs.

#### Why it is needed
Databases are vulnerable to SQL injection, accidental public exposure, backup leaks, and rogue insiders. If passwords were saved in plaintext, an attacker reading the database would instantly obtain the credentials for every account on the platform, and because users frequently reuse passwords, gain unauthorized access to their personal email and financial accounts across other services. Hashing ensures that a leaked database yields only computationally intractable strings that require massive computing power to crack.

#### How I implemented it
Implemented in `src/server/password.js` using `bcrypt` with a cost factor of 15 (`SALT_ROUNDS = 15`), generating approximately 32,768 iterations per hash. In `authenticateUser()` (`src/server/auth.service.js`), password comparisons use constant-time `bcrypt.compare()`. When an email is not found, the server executes a comparison against a dummy bcrypt hash (`DUMMY_BCRYPT_HASH`) so response times remain identical, defeating timing side-channel attacks.

```javascript
// src/server/password.js
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 15;

async function hashPassword(plainPassword) {
  if (!plainPassword || typeof plainPassword !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  return await bcrypt.hash(plainPassword, SALT_ROUNDS);
}
```

#### What I chose against, and why
I chose against general-purpose cryptographic hashes like SHA-256 and SHA-512. Standard SHA hashes are intentionally designed to be extremely fast for file integrity and message signing, meaning an attacker with consumer GPUs can compute billions of guesses per second, rendering dictionary attacks effortless. While Argon2id is technically the Password Hashing Competition winner, `bcrypt` with a high cost factor (15) provides battle-tested security, native C-bindings without complex external runtime prerequisites in Node.js, and takes 1–2 seconds per hash, which negligibly affects a single legitimate user while making brute-force cracking completely prohibitive.

---

### Rate Limiting

#### What it is
Rate limiting is a traffic throttling mechanism that counts the number of requests arriving from a specific client or targeting a specific account within a sliding time window. When incoming attempts exceed a pre-defined threshold, the server rejects subsequent requests for a set cooldown duration.

#### Why it is needed
Without rate limiting, an attacker can launch automated dictionary attacks submitting hundreds of passwords per second against an account until guessing correctly. Each attempt forces the server to execute an expensive password hash comparison and a database query, exhausting CPU resources, saturating database connection pools, and running up infrastructure hosting costs.

#### How I implemented it
Implemented in `src/server/rate-limit.service.js` using composite keys that map normalized emails directly to client IP addresses (`email::ip`). It enforces a strict lockout after 4 consecutive failures within a 15-minute sliding window. Furthermore, it incorporates a distinct Credential Stuffing defense: if a single IP address fails across 3 or more distinct accounts, or reaches 6 total failures across any accounts, the entire IP address is blocked globally for 30 minutes.

```javascript
// src/server/rate-limit.service.js
let attempt = this.emailIpAttempts.get(compositeKey);
if (attempt.failedCount >= MAX_FAILED_ATTEMPTS) {
  attempt.lockedUntil = now + LOCKOUT_DURATION_MS;
  const waitMinutes = Math.max(1, Math.ceil((attempt.lockedUntil - now) / 60000));
  const err = new Error(`Too many failed login attempts. Please try again in ${waitMinutes} minute(s).`);
  err.isRateLimited = true;
  throw err;
}
```

#### What I chose against, and why
I chose against naive IP-only rate limiting and naive account-only rate limiting. IP-only rate limiting causes severe false positives for honest users sharing an IP address behind a university campus, office network, or mobile carrier NAT. Conversely, account-only rate limiting creates a denial-of-service vector where a malicious actor deliberately submits wrong passwords to lock an honest user out of their own account. By combining `(email, IP)` composite keys with distinct multi-account IP tracking, malicious IPs are blocked without collateral damage to legitimate users.

---

### Client-side versus Server-side Validation

#### What it is
Client-side validation is input verification executed inside the user's browser via JavaScript as they type or submit a form, giving immediate visual feedback. Server-side validation is authoritative verification executed inside the backend API before any business logic or database queries run, rejecting any payload that violates system invariants.

#### Why it is needed
Relying solely on client-side validation is fatal because the browser environment is completely untrusted; anyone can bypass client code using `curl`, Postman, or automated scripts, submitting SQL injection strings, oversized buffers, or malformed data directly to endpoints. Conversely, relying solely on server-side validation produces frustrating user experiences, requiring full network round-trips and page reloads just to notify a user of a typo.

#### How I implemented it
Client validation is built into React form components (`src/components/SignUpForm.jsx`, `SignInForm.jsx`), using real-time regex testing, trimmed length checks, and accessible `aria-live` announcements. Server validation is authoritatively enforced in `src/server/validation.js` using strict Zod schemas (`signUpSchema`, `signInSchema`, `resetPasswordSchema`) that parse names, lowercase and trim emails, and validate character sets before data reaches the database service.

```javascript
// src/server/validation.js
const signUpSchema = z.object({
  name: z.string().trim().min(1).max(120)
    .refine((v) => /^[a-zA-Z\s]+$/.test(v), { message: 'Full Name Must Use Only Letters' })
    .refine((v) => v.split(/\s+/).filter(Boolean).length >= 2, { message: 'Please enter atleast two names' }),
  email: z.string().trim().min(1).max(254).toLowerCase().email(),
  password: z.string().min(8).max(128)
    .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[#@>\^]|[^a-zA-Z0-9\s]/.test(v))
});
```

#### What I chose against, and why
I chose against relying on ad-hoc, manual `if (!email) ...` checks scattered across individual route handlers. Manual checks are prone to human oversight, leading to inconsistencies where one endpoint enforces an email length limit while another omits it. Centralizing authoritative validation in formal Zod schemas guarantees that backend security boundaries remain uniform, strictly typed, and impervious to client tampering.

---

### Session Management and Why You Chose Sessions or Tokens

#### What it is
Session management is the mechanism used to maintain authenticated user state across stateless HTTP requests. It is implemented either via stateful server-managed sessions (where a random identifier references a record stored in the database) or stateless client-managed tokens (such as JSON Web Tokens / JWTs, where claims are encoded and signed cryptographically within the token itself).

#### Why it is needed
Without session management, HTTP's stateless protocol would require users to submit their credentials on every single page view or API call. Flawed session management allows stolen session IDs to hijack user accounts indefinitely, with no mechanism for administrators or users to terminate compromised sessions.

#### How I implemented it
I implemented stateful, database-backed sessions in PostgreSQL (`prisma/schema.prisma`) paired with Auth.js-compatible HTTP cookies (`authjs.session-token`) configured with `HttpOnly; SameSite=Lax; Path=/` (`src/server/auth-cookies.js`). The cookie stores an unguessable 256-bit random string (`crypto.randomBytes(32)`), whose SHA-256 hash is queried against the `sessions` table on every request.

```javascript
// src/server/auth.service.js & auth-cookies.js
const sessionToken = crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
await prisma.session.create({
  data: { userId: user.id, tokenHash, type: 'full', expiresAt }
});
const sessionCookie = createSessionCookie(sessionToken);
res.setHeader('Set-Cookie', [sessionCookie]);
```

#### What I chose against, and why
I chose against stateless JWTs stored in browser `localStorage` or cookies. The fundamental flaw of stateless JWTs is the impossibility of immediate server-side revocation: if a user logs out, clicks "Sign out of all devices", or changes an exposed password, an issued JWT remains completely valid until its cryptographic expiration time passes unless an external revocation blacklist is built—which reintroduces state and defeats JWT's original purpose. Database-backed sessions allow immediate, authoritative revocation (`revokedAt = new Date()`) during logout or password reset.

---

### Token and Code Expiry, and Why Expiry Must Live in the Database

#### What it is
Token and code expiry assigns an explicit, short validity window to credentials (such as 5 minutes for email codes, 15 minutes for password resets, and 30 days for sessions), rendering them permanently invalid once that window lapses. Storing expiry timestamps in database columns ensures that validity is evaluated authoritatively by database queries.

#### Why it is needed
If reset tokens or verification codes never expire, an unused reset link from an old email backup could be exploited months later to hijack an account. If expiry is evaluated only in application memory or client code, restarting the backend or tampering with system clocks allows expired tokens to be accepted.

#### How I implemented it
Every transient model (`EmailVerificationCode`, `PasswordResetToken`, `Session`) contains an explicit non-nullable `expiresAt DateTime` column in PostgreSQL. Database lookups in `src/server/auth.service.js` filter out expired records at query time (`expiresAt: { gt: new Date() }`), guaranteeing that expired credentials are systematically ignored.

```javascript
// src/server/auth.service.js
const tokenRecord = await prisma.passwordResetToken.findFirst({
  where: {
    userId: user.id,
    usedAt: null,
    voidedAt: null,
    expiresAt: { gt: new Date() }
  },
  orderBy: { createdAt: 'desc' }
});
```

#### What I chose against, and why
I chose against managing expiration via in-memory JavaScript timers (`setTimeout`) or relying on JWT `exp` claims alone. In-memory timers are destroyed whenever a Node.js process reboots, crashes, or scales across multiple containers. Database-resident expiry timestamps are persistent, ACID-compliant, and shared identically across every backend cluster instance.

---

### Idempotency

#### What it is
Idempotency is the property of an API operation where executing the identical request multiple times produces the exact same outcome as executing it once, preventing duplicate records or unintended secondary side effects.

#### Why it is needed
On mobile networks, users often encounter latency, causing them to tap submit buttons repeatedly. Furthermore, network proxies frequently retry dropped POST requests. Without idempotency, a registration endpoint will execute multiple bcrypt hashing cycles (stalling the server CPU), fire duplicate confirmation emails, and either trigger database unique constraint collisions or generate duplicate pending records.

#### How I implemented it
Implemented via `signupIdempotency` in `src/server/idempotency.js`, wrapped around `registerUser()` in `src/server/auth.service.js`. It utilizes an in-flight single-flight mutex combined with an in-memory response cache keyed by `Idempotency-Key` and `emailNormalized`. Concurrent identical requests join the active executing promise; duplicate requests arriving within 5 minutes receive the cached successful response with the `X-Idempotent-Replay` header.

```javascript
// src/server/idempotency.js
const activeFlight = this.getInFlight(key) || this.getInFlight(emailKey);
if (activeFlight) {
  const result = await activeFlight;
  return { ...result, isIdempotentReplay: true };
}
```

#### What I chose against, and why
I chose against relying solely on client-side button disabling (`disabled={isLoading}`). Client-side disabling is purely a cosmetic UI guard; it cannot protect against automated script retries, network-level retries, or double-clicks registered before JavaScript event listeners initialize. Server-side idempotency guarantees deduplication regardless of client behavior.

---

### Database Constraints as a Last Line of Defence

#### What it is
Database constraints are non-negotiable structural rules (unique indexes, foreign keys, check constraints, and not-null directives) enforced directly by the relational database storage engine (PostgreSQL), below any application code or ORM framework.

#### Why it is needed
Application code is susceptible to bugs, unhandled exceptions, and asynchronous race conditions. Two concurrent requests can both execute an application-level check `if (!findUser(email))`, find no existing account, pass validation simultaneously, and both attempt to insert. Without database-level unique constraints, both rows are written, permanently corrupting database referential integrity and breaking login lookups.

#### How I implemented it
Configured in `prisma/schema.prisma` with `@unique` on `User.emailNormalized` and `LoginAttempt.emailNormalized`, non-nullable constraints on password hashes, and foreign keys configured with `onDelete: Cascade`. In `src/server/auth.service.js`, user creation is wrapped in an atomic transaction that explicitly handles PostgreSQL collision error `P2002`.

```javascript
// src/server/auth.service.js
try {
  user = await prisma.$transaction(async (tx) => {
    return await tx.user.create({ data: { ... } });
  });
} catch (err) {
  if (err.code === 'P2002') {
    user = await prisma.user.findUnique({ where: { emailNormalized } });
  } else {
    throw err;
  }
}
```

#### What I chose against, and why
I chose against relying solely on application-level pre-checks like `const exists = await prisma.user.findUnique(...)`. Application-level pre-checks are subject to the Time-of-Check to Time-of-Use (TOCTOU) vulnerability, where state changes between the check and the insert. Database constraints are enforced at the physical disk page and index level, acting as an unbreachable barrier when application logic encounters concurrency.

---

### Protected Routes

#### What it is
Protected routes are web pages and API endpoints that restrict access exclusively to clients holding an authenticated, active session. Any request lacking a valid session is blocked and redirected to the sign-in screen.

#### Why it is needed
Without protected routes, confidential screens—such as account dashboards, billing records, and personal settings—could be viewed by anyone who enters the URL into a browser address bar, completely exposing private user data to unauthorized parties.

#### How I implemented it
Implemented with defense-in-depth across both backend and frontend layers:
1. An authoritative API endpoint `GET /api/auth/session` (`src/server/api.js`) validates the `authjs.session-token` cookie against the database `sessions` table, verifying that `revokedAt == null` and `now < expiresAt`.
2. A client-side guard on `dashboard.html` queries `/api/auth/session` on initial load, instantly redirecting unauthenticated visitors to `sign-in.html?flash=session_expired`.
3. A `visibilitychange` listener on `dashboard.html` that re-checks the session whenever the tab regains focus, immediately kicking out users who signed out in another tab.
4. `Cache-Control: no-store` HTTP headers to prevent the browser back button from restoring cached authenticated screens after logout.

```javascript
// dashboard.html
fetch('/api/auth/session', { credentials: 'include' })
  .then((res) => res.json())
  .then((data) => {
    if (!data.authenticated || !data.user) {
      sessionStorage.clear();
      window.location.href = 'sign-in.html?flash=session_expired';
    }
  });
```

#### What I chose against, and why
I chose against client-only route protection (such as checking `sessionStorage.getItem('isLoggedIn')` in JavaScript without querying the backend). Client-only storage is trivially manipulated by opening browser developer tools and setting fake keys. Secure route protection must always validate a cryptographic token against the authoritative server session database.

---

## Section 6: What Went Wrong

### Problem 1: Bcrypt Cost Factor 15 Event Loop Starvation
- **The Symptom:** During automated sign-in tests and concurrent login attempts, the Node.js server became unresponsive, request latency jumped from 20ms to over 3,000ms, and incoming Vite dev server asset requests timed out with socket hangups.
- **The Investigation:** Initially investigated whether PostgreSQL connection pooling in Neon was stalling under load or whether network latency to the cloud database was the bottleneck. Checked PgBouncer connection metrics, which showed active database connections remained under 4. Next checked whether outbound Nodemailer SMTP sockets were hanging. Finally, ran Node.js with CPU profiling (`node --prof`), which revealed that `bcrypt.hash()` and `bcrypt.compare()` in `src/server/password.js` were saturating 100% of the single-threaded CPU capacity.
- **The Cause:** Bcrypt cost factor 15 requires $2^{15} = 32,768$ iterations. On modern hardware, each calculation consumes roughly 1,500ms to 2,000ms of CPU compute. Because `authenticateUser` executed a constant-time dummy hash on non-existent users, multiple concurrent failed logins queued up on Node's libuv thread pool, starving all incoming HTTP connections.
- **The Fix:** Configured `BCRYPT_SALT_ROUNDS` via `.env` allowing test suites and development environments to run at cost factor 10 for rapid execution, while documenting cost factor 15 for high-security production deployments with increased libuv thread worker pools (`UV_THREADPOOL_SIZE=8`).

### Problem 2: PowerShell Script Execution Policy Blocking `npm` on Windows
- **The Symptom:** Running `npm test` or `npm run dev` in Windows PowerShell immediately threw a fatal security error: `File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system. PSSecurityException: UnauthorizedAccess`.
- **The Investigation:** Checked if Node.js was properly configured in the system PATH. Checked Windows file permissions and user privileges on the project directory. Attempted running from different shell subdirectories.
- **The Cause:** Windows PowerShell defaults to a `Restricted` execution policy, which blocks `.ps1` script wrappers (like `npm.ps1` installed by Node.js) from executing in terminal sessions, even though binary executables (`node.exe`, `npm.cmd`) run without issue.
- **The Fix:** Updated documentation to advise developers to invoke `npm.cmd` directly or configure PowerShell execution permissions using `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`, and verified that direct `node <script>` invocations run reliably across all Windows environments.

### Problem 3: TOCTOU Race Condition in Concurrent Registration
- **The Symptom:** When firing automated concurrent registration requests with identical email addresses at the exact same millisecond, one request succeeded with HTTP 200 while the second crashed with an unhandled exception: `PrismaClientKnownRequestError: Unique constraint failed on the fields: (email_normalized) [code: P2002]`.
- **The Investigation:** Investigated why the application pre-check `await prisma.user.findUnique({ where: { emailNormalized } })` did not catch the duplicate. Verified database transaction isolation levels.
- **The Cause:** A classic Time-of-Check to Time-of-Use (TOCTOU) race condition. Both asynchronous requests executed the `findUnique()` query simultaneously before either had committed an insert, both observed that no user existed, and both proceeded to execute `tx.user.create()`. The second insert collided with PostgreSQL's unique index constraint, throwing error `P2002`.
- **The Fix:** Implemented two coordinated defenses: first, added single-flight request mutex deduplication in `src/server/idempotency.js` to intercept concurrent requests before they reach the database; second, wrapped the database insert in a `try/catch` block that specifically catches error code `P2002`, queries the committed record, and resolves the request idempotently.

### Problem 4: Multi-Tab Logout Desynchronization
- **The Symptom:** When a user opened the dashboard across two separate browser tabs (Tab A and Tab B), clicked "Sign out" in Tab A, and then switched back to Tab B, Tab B remained displaying "Signed in as User" and appeared active until the user manually refreshed the page.
- **The Investigation:** Checked if the session cookie was cleared; `authjs.session-token` was indeed deleted by Tab A. Checked `sessionStorage`, discovering that `sessionStorage` is isolated per browser tab and does not synchronize cross-tab state. Tested broadcasting events via `localStorage` storage events.
- **The Cause:** Tab B had loaded the static dashboard view into memory and was completely idle. Because no HTTP requests were fired while the tab sat in the background, Tab B never contacted `/api/auth/session` to discover that its session had been revoked on the server.
- **The Fix:** Added a `document.addEventListener('visibilitychange')` listener in `dashboard.html`. Whenever Tab B regains focus (`document.visibilityState === 'visible'`), it immediately dispatches a background fetch to `/api/auth/session`. Finding the session revoked or missing, it clears local state and redirects to `sign-in.html?flash=session_expired`. Additionally added `Cache-Control: no-store` HTTP response headers to prevent browser forward/back cache restoration.

---

## Section 7: What This Slice Does Not Handle

### What Breaks at Scale
1. **In-Memory Rate Limiting and Idempotency Stores:** The sliding-window rate limit counters (`rateLimitService.emailIpAttempts`), single-flight locks (`signupIdempotency`), and password reset code stores currently live in Node.js process memory (`Map`). If this application is deployed across multiple container instances behind a load balancer or on serverless infrastructure (e.g. AWS Lambda, ECS, Kubernetes), requests from the same user or attacker will hit different server instances, bypassing local rate limits and breaking idempotency caches. At scale, all rate-limit counters and idempotency locks must be externalized to a distributed Redis cluster.
2. **In-Memory Asynchronous Job Queue:** The email job queue (`emailQueue`) uses an in-memory `EventEmitter` FIFO queue. If the Node.js server crashes or restarts while jobs are pending, those email delivery tasks are permanently lost. High-volume production systems require a durable message broker like Redis with BullMQ, Amazon SQS, or RabbitMQ with persistent dead-letter queues.

### What Would Be Needed Before Real Users Touched It
1. **Account Lockout Notification Emails:** The system locks out an account after 4–5 consecutive failed sign-ins, but it does not yet send an automated security alert email informing the legitimate owner that an unauthorized actor is attempting to brute-force their credentials.
2. **Breached Password Checking:** The system enforces standard length and character complexity rules, but does not query the HaveIBeenPwned API (via k-Anonymity) to block passwords that have already appeared in known public data breaches.
3. **Production Transactional Email Infrastructure:** The slice currently connects via direct SMTP. Real-world delivery requires integrating with dedicated transactional email APIs (such as SendGrid, AWS SES, or Postmark) with automated bounce management, DKIM/SPF domain verification, and webhook handling for dropped messages.
4. **Comprehensive CSRF Protection on All POST Endpoints:** While sign-in validates CSRF tokens, strict double-submit cookie validation and origin checking should be uniformly applied across every mutating route via dedicated middleware before public deployment.

### Features Left Out: Outside Brief vs. Ran Out of Time
- **Deliberately Left Out (Outside the Brief):**
  - OAuth2 and Social Sign-In (Google, GitHub, Apple).
  - Multi-Factor Authentication (TOTP authenticator apps, WebAuthn, passkeys).
  - Role-Based Access Control (RBAC) and permissions.
  - User self-service profile editing and avatar uploads.
  - Organization multi-tenancy and team member invitations.
  *(These belong to product domain logic rather than the core authentication slice).*
- **Left Out Due to Time Constraints:**
  - Redis backing for distributed rate-limiting counters and background queues.
  - Sliding session expiration (refresh token rotation / activity-based session extensions).
  - An administrative session management panel allowing users to view and revoke active sessions across specific devices or IP locations.

---

## Section 8: If I Built This Again

The single biggest thing I would do differently is to adopt an externalized Redis cache and queue layer from the very beginning instead of relying on in-memory JavaScript Maps and an EventEmitter-based job queue. While in-process storage works seamlessly for single-instance development and automated test suites, it splits application state into two conflicting domains—persistent relational data in PostgreSQL versus ephemeral security counters, queue jobs, and idempotency locks in Node's memory space—which creates significant architectural friction when migrating to horizontal scaling across multiple container instances. Introducing Redis from day one for rate-limiting, job queueing, and idempotency tracking would ensure atomic, distributed consistency across all nodes, survive application restarts without losing pending verification emails, and keep relational database connection pools completely uncluttered by high-frequency rate-limit tracking queries.

