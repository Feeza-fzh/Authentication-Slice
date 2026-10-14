import React, { useState, useRef, useEffect } from 'react';

// Email domain validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sequential password requirements helper
export function getNextPasswordRequirement(val) {
  if (!/[a-z]/.test(val)) {
    return 'Password must contain a lowercase letter';
  }
  if (!/[A-Z]/.test(val)) {
    return 'Password must contain an uppercase letter';
  }
  if (!/[#@>\^]/.test(val) && !/[^a-zA-Z0-9\s]/.test(val)) {
    return 'Password must contain a special character(#@>^)';
  }
  if (val.length < 8) {
    return 'Minimum of 8 character';
  }
  return null;
}

export function isNameValid(val) {
  const trimmed = (val || '').trim();
  if (!trimmed) return false;
  if (/[^a-zA-Z\s]/.test(val)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (trimmed.length > 120) return false;
  return true;
}

export function isEmailValid(val) {
  const trimmed = (val || '').trim().toLowerCase();
  if (!trimmed) return false;
  if (!EMAIL_REGEX.test(trimmed)) return false;
  if (trimmed.length > 254) return false;
  return true;
}

export function isPasswordValid(val) {
  if (!val) return false;
  if (getNextPasswordRequirement(val) !== null) return false;
  if (val.length > 128) return false;
  return true;
}

export function parseFullName(rawName) {
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

export default function SignUpForm() {
  // Form State managed via useState
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Error & requirement states managed via useState
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordRequirement, setPasswordRequirement] = useState('');
  const [formAlert, setFormAlert] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [liveRegionText, setLiveRegionText] = useState('');

  // Idempotency and in-flight request lock to prevent duplicate clicks on slow networks
  const isSubmittingRef = useRef(false);
  const idempotencyKeyRef = useRef(null);

  // Auto-dismiss form error alert banner after 6 seconds
  useEffect(() => {
    if (formAlert) {
      const timer = setTimeout(() => {
        setFormAlert('');
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [formAlert]);

  // Real-time Name handler
  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);

    if (/[^a-zA-Z\s]/.test(val)) {
      setNameError('Full Name Must Use Only Letters');
      setLiveRegionText('Full Name Must Use Only Letters');
    } else if (nameError === 'Full Name Must Use Only Letters') {
      setNameError('');
    }
  };

  const handleNameBlur = () => {
    const trimmedEnd = name.trimEnd();
    setName(trimmedEnd);
    const val = trimmedEnd.trim();

    if (!val) {
      setNameError('Full name field cannot be empty');
      setLiveRegionText('Full name field cannot be empty');
    } else if (/[^a-zA-Z\s]/.test(trimmedEnd)) {
      setNameError('Full Name Must Use Only Letters');
      setLiveRegionText('Full Name Must Use Only Letters');
    } else {
      const words = val.split(/\s+/).filter(Boolean);
      if (words.length < 2) {
        setNameError('Please enter atleast two names');
        setLiveRegionText('Please enter atleast two names');
      } else {
        setNameError('');
      }
    }
  };

  // Real-time Email handler - bounces down all email addresses to lowercase
  const handleEmailChange = (e) => {
    const val = e.target.value.toLowerCase();
    setEmail(val);

    if (val.length === 0) {
      setEmailError('');
    } else if (EMAIL_REGEX.test(val.trim()) && val.trim().length <= 254) {
      setEmailError('');
    } else {
      setEmailError('Enter a Valid Email Address');
      setLiveRegionText('Enter a Valid Email Address');
    }
  };

  const handleEmailBlur = () => {
    const trimmedEnd = email.trimEnd().toLowerCase();
    setEmail(trimmedEnd);
    const val = trimmedEnd.trim();

    if (!val) {
      setEmailError('Email address field cannot be empty');
      setLiveRegionText('Email address field cannot be empty');
    } else if (!EMAIL_REGEX.test(val) || val.length > 254) {
      setEmailError('Enter a Valid Email Address');
      setLiveRegionText('Enter a Valid Email Address');
    } else {
      setEmailError('');
    }
  };

  // Real-time Password handler
  const handlePasswordChange = (e) => {
    const val = e.target.value;
    setPassword(val);

    if (passwordError) {
      setPasswordError('');
    }

    if (val.length === 0) {
      setPasswordRequirement('');
    } else {
      const unmet = getNextPasswordRequirement(val);
      setPasswordRequirement(unmet || '');
    }
  };

  const handlePasswordBlur = () => {
    const trimmedEnd = password.trimEnd();
    setPassword(trimmedEnd);
    const val = trimmedEnd.trim();

    if (!val) {
      setPasswordError('Password field cannot be empty');
      setPasswordRequirement('');
      setLiveRegionText('Password field cannot be empty');
    } else {
      const unmet = getNextPasswordRequirement(val);
      if (unmet) {
        setPasswordError(unmet);
        setPasswordRequirement('');
        setLiveRegionText(unmet);
      } else {
        setPasswordError('');
      }
    }
  };

  // Derived button disabled state
  const isSubmitDisabled =
    isLoading ||
    !isNameValid(name) ||
    !isEmailValid(email) ||
    !isPasswordValid(password);

  const handleSubmit = (e) => {
    e.preventDefault();

    // Prevent duplicate requests when user clicks rapidly or on slow connections
    if (isSubmittingRef.current || isLoading) {
      return;
    }

    const trimmedName = name.trimEnd();
    const trimmedEmail = email.trimEnd().toLowerCase();
    const trimmedPassword = password.trimEnd();

    setName(trimmedName);
    setEmail(trimmedEmail);
    setPassword(trimmedPassword);

    const rawName = trimmedName;
    const nameVal = rawName.trim();
    const emailVal = trimmedEmail.trim().toLowerCase();
    const passVal = trimmedPassword;

    let hasError = false;

    // Full name validation
    if (!nameVal) {
      setNameError('Full name field cannot be empty');
      hasError = true;
    } else if (/[^a-zA-Z\s]/.test(rawName)) {
      setNameError('Full Name Must Use Only Letters');
      hasError = true;
    } else {
      const words = nameVal.split(/\s+/).filter(Boolean);
      if (words.length < 2) {
        setNameError('Please enter atleast two names');
        hasError = true;
      } else if (nameVal.length > 120) {
        setNameError('Name must be 120 characters or fewer.');
        hasError = true;
      } else {
        setNameError('');
      }
    }

    // Email validation
    if (!emailVal) {
      setEmailError('Email address field cannot be empty');
      hasError = true;
    } else if (!EMAIL_REGEX.test(emailVal) || emailVal.length > 254) {
      setEmailError('Enter a Valid Email Address');
      hasError = true;
    } else {
      setEmailError('');
    }

    // Password validation
    if (!passVal) {
      setPasswordError('Password field cannot be empty');
      hasError = true;
    } else {
      const unmet = getNextPasswordRequirement(passVal);
      if (unmet) {
        setPasswordError(unmet);
        hasError = true;
      } else if (passVal.length > 128) {
        setPasswordError('Password must be 128 characters or fewer.');
        hasError = true;
      } else {
        setPasswordError('');
      }
    }

    if (hasError) {
      setLiveRegionText('Form submission contains errors. Please review the highlighted fields.');
      return;
    }

    // Collect structured name details
    const parsedName = parseFullName(nameVal);

    isSubmittingRef.current = true;
    setIsLoading(true);
    setLiveRegionText('Creating account...');

    // Generate or maintain client idempotency key for this submission attempt
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    const idempotencyKey = idempotencyKeyRef.current;

    // Call registration endpoint with Idempotency-Key header and payload
    fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        name: nameVal,
        email: emailVal,
        password: passVal,
        idempotencyKey
      })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          isSubmittingRef.current = false;
          // Clear idempotency key so user can submit corrected data
          idempotencyKeyRef.current = null;
          setFormAlert(data.error);
          setLiveRegionText(data.error);
          setIsLoading(false);
          return;
        }

        sessionStorage.setItem('pending_verification_email', emailVal);
        sessionStorage.setItem('auth_user_name', parsedName.fullName);
        sessionStorage.setItem('auth_user_first_name', parsedName.firstName);
        sessionStorage.setItem('auth_user_middle_name', parsedName.middleName || '');
        sessionStorage.setItem('auth_user_last_name', parsedName.lastName);
        sessionStorage.setItem('auth_user_name_details', JSON.stringify(parsedName));
        if (data.verificationCode) {
          sessionStorage.setItem('demo_verification_code', data.verificationCode);
        }
        window.location.href = 'verify-email.html';
      })
      .catch(() => {
        isSubmittingRef.current = false;
        // Fallback for static file serving without active API server
        sessionStorage.setItem('pending_verification_email', emailVal);
        sessionStorage.setItem('auth_user_name', parsedName.fullName);
        sessionStorage.setItem('auth_user_first_name', parsedName.firstName);
        sessionStorage.setItem('auth_user_middle_name', parsedName.middleName || '');
        sessionStorage.setItem('auth_user_last_name', parsedName.lastName);
        sessionStorage.setItem('auth_user_name_details', JSON.stringify(parsedName));
        window.location.href = 'verify-email.html';
      });
  };

  return (
    <main className="auth-container">
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">Create account</h1>
          <p className="auth-subtitle">Get started with your free account today.</p>
        </header>

        {/* Live announcement region for screen readers */}
        <div id="status-live-region" className="sr-only" aria-live="polite" aria-atomic="true">
          {liveRegionText}
        </div>

        {/* Form-level alert banner */}
        {formAlert && (
          <div id="form-alert" className="alert-banner alert-error" role="alert">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            <span id="form-alert-text">{formAlert}</span>
          </div>
        )}

        <form id="signup-form" className="auth-form" method="POST" onSubmit={handleSubmit} noValidate>
          {/* Full name */}
          <div className="form-group">
            <label htmlFor="name" className="form-label">Full name</label>
            <div className="input-container">
              <input
                type="text"
                id="name"
                name="name"
                className={`form-input ${nameError ? 'is-invalid' : ''}`}
                required
                maxLength={120}
                autoComplete="name"
                tabIndex={1}
                aria-describedby="name-error"
                aria-invalid={!!nameError}
                value={name}
                onChange={handleNameChange}
                onBlur={handleNameBlur}
                disabled={isLoading}
              />
            </div>
            <div id="name-error" className={`field-error ${nameError ? 'visible' : ''}`} role="alert" aria-live="polite">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <span className="field-error-text">{nameError}</span>
            </div>
          </div>

          {/* Email address */}
          <div className="form-group">
            <label htmlFor="email" className="form-label">Email address</label>
            <div className="input-container">
              <input
                type="email"
                id="email"
                name="email"
                className={`form-input ${emailError ? 'is-invalid' : ''}`}
                required
                maxLength={254}
                autoComplete="email"
                tabIndex={2}
                aria-describedby="email-error"
                aria-invalid={!!emailError}
                value={email}
                onChange={handleEmailChange}
                onBlur={handleEmailBlur}
                disabled={isLoading}
              />
            </div>
            <div id="email-error" className={`field-error ${emailError ? 'visible' : ''}`} role="alert" aria-live="polite">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <span className="field-error-text">{emailError}</span>
            </div>
          </div>

          {/* Password */}
          <div className="form-group">
            <label htmlFor="password" className="form-label">Password</label>
            <div className="input-container has-toggle">
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                name="password"
                className={`form-input ${passwordError ? 'is-invalid' : ''}`}
                required
                maxLength={128}
                autoComplete="new-password"
                tabIndex={3}
                aria-describedby="password-error password-requirements"
                aria-invalid={!!passwordError}
                value={password}
                onChange={handlePasswordChange}
                onBlur={handlePasswordBlur}
                disabled={isLoading}
              />
              <button
                type="button"
                id="password-toggle"
                className="toggle-password-btn"
                tabIndex={4}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(prev => !prev)}
                disabled={isLoading}
              >
                {!showPassword ? (
                  <svg id="toggle-icon-show" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                ) : (
                  <svg id="toggle-icon-hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                )}
              </button>
            </div>
            {passwordRequirement && (
              <p id="password-requirements" className="field-hint" style={{ display: 'block' }}>
                {passwordRequirement}
              </p>
            )}
            <div id="password-error" className={`field-error ${passwordError ? 'visible' : ''}`} role="alert" aria-live="polite">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <span className="field-error-text">{passwordError}</span>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            id="submit-btn"
            className={`btn btn-primary ${isLoading ? 'is-loading' : ''}`}
            tabIndex={5}
            disabled={isSubmitDisabled}
          >
            <span className="btn-spinner" aria-hidden="true"></span>
            <span id="submit-btn-text">{isLoading ? 'Creating account...' : 'Create account'}</span>
          </button>
        </form>

        <footer className="auth-footer">
          <p>
            Already have an account? <a href="sign-in.html" className="auth-link" tabIndex={6}>Sign in</a>
          </p>
        </footer>
      </div>
    </main>
  );
}
