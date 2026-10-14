/**
 * Server-Side Form Validation using Zod
 * Enforces business logic and security constraints for authentication forms.
 */

const { z } = require('zod');

// Regex constants
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LETTERS_AND_SPACES_REGEX = /^[a-zA-Z\s]+$/;
const SPECIAL_CHAR_REGEX = /[#@>\^]|[^a-zA-Z0-9\s]/;

/**
 * Helper to parse full name into structured components
 * @param {string} rawName 
 */
function parseFullName(rawName) {
  const words = rawName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1) {
    return {
      fullName: words[0],
      firstName: words[0],
      middleName: null,
      lastName: ''
    };
  }
  if (words.length === 2) {
    return {
      fullName: words.join(' '),
      firstName: words[0],
      middleName: null,
      lastName: words[1]
    };
  }
  return {
    fullName: words.join(' '),
    firstName: words[0],
    middleName: words.slice(1, -1).join(' '),
    lastName: words[words.length - 1]
  };
}

/**
 * 1. Sign Up (Create Account) Validation Schema
 */
const signUpSchema = z.object({
  name: z
    .string({ required_error: 'Full name field cannot be empty' })
    .trim()
    .min(1, 'Full name field cannot be empty')
    .max(120, 'Name must be 120 characters or fewer.')
    .refine((val) => LETTERS_AND_SPACES_REGEX.test(val), {
      message: 'Full Name Must Use Only Letters'
    })
    .refine((val) => val.split(/\s+/).filter(Boolean).length >= 2, {
      message: 'Please enter atleast two names'
    }),
  email: z
    .string({ required_error: 'Email address field cannot be empty' })
    .trim()
    .min(1, 'Email address field cannot be empty')
    .max(254, 'Enter a Valid Email Address')
    .toLowerCase()
    .refine((val) => EMAIL_REGEX.test(val), {
      message: 'Enter a Valid Email Address'
    }),
  password: z
    .string({ required_error: 'Password field cannot be empty' })
    .min(8, 'Minimum of 8 character')
    .max(128, 'Password must be 128 characters or fewer.')
    .refine((val) => /[a-z]/.test(val), {
      message: 'Password must contain a lowercase letter'
    })
    .refine((val) => /[A-Z]/.test(val), {
      message: 'Password must contain an uppercase letter'
    })
    .refine((val) => SPECIAL_CHAR_REGEX.test(val), {
      message: 'Password must contain a special character(#@>^)'
    })
});

/**
 * 2. Sign In Validation Schema
 * Per PRD 6.2: Email format check and non-empty password only. No password complexity rules apply here.
 */
const signInSchema = z.object({
  email: z
    .string({ required_error: 'Email address field cannot be empty' })
    .trim()
    .min(1, 'Email address field cannot be empty')
    .max(254, 'Enter a valid email address.')
    .toLowerCase()
    .refine((val) => EMAIL_REGEX.test(val), {
      message: 'Enter a valid email address.'
    }),
  password: z
    .string({ required_error: 'Password field cannot be empty' })
    .min(1, 'Password field cannot be empty')
    .max(128, 'Password must be 128 characters or fewer.')
});

/**
 * 3. Forgot Password Validation Schema
 * Per PRD 6.3: Valid email format, 254 characters max.
 */
const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: 'Email address field cannot be empty' })
    .trim()
    .min(1, 'Email address field cannot be empty')
    .max(254, 'Enter a valid email address.')
    .toLowerCase()
    .refine((val) => EMAIL_REGEX.test(val), {
      message: 'Enter a valid email address.'
    })
});

/**
 * 4. Reset Password Validation Schema
 * Per PRD 6.4: Password rules match requirements and both password fields must match.
 */
const resetPasswordSchema = z
  .object({
    token: z
      .string({ required_error: 'Reset token is required' })
      .trim()
      .min(1, 'Reset token is required'),
    newPassword: z
      .string({ required_error: 'New password field cannot be empty' })
      .min(10, 'Password must be at least 10 characters.')
      .max(128, 'Password must be 128 characters or fewer.')
      .refine((val) => /[a-zA-Z]/.test(val) && /[0-9]/.test(val), {
        message: 'Password must include at least one letter and one number.'
      }),
    confirmPassword: z
      .string({ required_error: 'Confirm new password field cannot be empty' })
      .min(1, 'Confirm new password field cannot be empty')
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword']
  });

/**
 * 5. Email Verification Code Validation Schema
 * Per PRD 6.5: Exactly 6 digits numeric string.
 */
const verifyEmailSchema = z.object({
  email: z
    .string({ required_error: 'Email address is required' })
    .trim()
    .toLowerCase()
    .refine((val) => EMAIL_REGEX.test(val), {
      message: 'Invalid email address'
    }),
  code: z
    .string({ required_error: 'Enter the 6-digit code.' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.')
});

/**
 * Formats Zod errors into a clean key-value object of field errors
 * @param {z.ZodError} zodError 
 * @returns {Record<string, string>}
 */
function formatZodErrors(zodError) {
  const errors = {};
  for (const issue of zodError.issues) {
    const field = issue.path[0] || 'general';
    if (!errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

/**
 * Custom ValidationError class
 */
class ValidationError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.errors = errors;
  }
}

/**
 * Validation runner helper
 * @param {z.ZodSchema} schema 
 * @param {any} data 
 * @returns {any} Validated and transformed data
 * @throws {ValidationError}
 */
function validate(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const formatted = formatZodErrors(result.error);
    const firstErrorMessage = result.error.issues[0]?.message || 'Validation failed';
    throw new ValidationError(firstErrorMessage, formatted);
  }
  return result.data;
}

module.exports = {
  signUpSchema,
  signInSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  validate,
  formatZodErrors,
  ValidationError,
  parseFullName
};
