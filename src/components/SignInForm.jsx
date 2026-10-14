import React, { useState, useEffect } from 'react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInForm() {
  // Form State managed via useState
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Errors & Alerts managed via useState
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formAlert, setFormAlert] = useState('');
  const [flashMessage, setFlashMessage] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [liveRegionText, setLiveRegionText] = useState('');
  const [csrfToken, setCsrfToken] = useState('');

  // Check URL parameters for flash messages per PRD on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flash = params.get('flash');
    if (flash === 'signed_out') {
      setFlashMessage({ text: 'You have signed out.', alertClass: 'alert-info' });
      setLiveRegionText('You have signed out.');
    } else if (flash === 'session_expired') {
      setFlashMessage({ text: 'Your session has expired. Sign in again.', alertClass: 'alert-info' });
      setLiveRegionText('Your session has expired. Sign in again.');
    } else if (flash === 'password_updated') {
      setFlashMessage({ text: 'Password updated. Sign in with your new password.', alertClass: 'alert-success' });
      setLiveRegionText('Password updated. Sign in with your new password.');
    }

    // State management: prefill remembered email while user session is active
    const activeEmail = sessionStorage.getItem('auth_active_email') ||
      sessionStorage.getItem('auth_user_email') ||
      sessionStorage.getItem('pending_verification_email') || '';
    if (activeEmail) {
      setEmail(activeEmail);
    }

    // Auto-focus email input on mount
    setTimeout(() => {
      const emailField = document.getElementById('email');
      if (emailField) {
        emailField.focus();
      }
    }, 0);

    // Fetch Auth.js CSRF token on mount
    fetch('/api/auth/csrf', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-dismiss flash banner after 6 seconds
  useEffect(() => {
    if (flashMessage) {
      const timer = setTimeout(() => {
        setFlashMessage(null);
        if (window.history.replaceState) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [flashMessage]);

  // Auto-dismiss form-level alert banner after 6 seconds
  useEffect(() => {
    if (formAlert) {
      const timer = setTimeout(() => {
        setFormAlert('');
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [formAlert]);

  const handleEmailBlur = () => {
    const trimmedEnd = email.trimEnd().toLowerCase();
    setEmail(trimmedEnd);
    const val = trimmedEnd.trim();

    if (!val) {
      setEmailError('Email address field cannot be empty');
      setLiveRegionText('Email address field cannot be empty');
    } else if (!EMAIL_REGEX.test(val.toLowerCase()) || val.length > 254) {
      setEmailError('Enter a valid email address.');
      setLiveRegionText('Enter a valid email address.');
    } else {
      setEmailError('');
    }
  };

  const handlePasswordBlur = () => {
    const trimmedEnd = password.trimEnd();
    setPassword(trimmedEnd);
    const val = trimmedEnd.trim();

    if (!val) {
      setPasswordError('Password field cannot be empty');
      setLiveRegionText('Password field cannot be empty');
    } else {
      setPasswordError('');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const trimmedEmail = email.trimEnd().toLowerCase();
    const trimmedPassword = password.trimEnd();
    setEmail(trimmedEmail);
    setPassword(trimmedPassword);

    const emailVal = trimmedEmail.trim().toLowerCase();
    const passVal = trimmedPassword;

    let hasError = false;

    if (!emailVal) {
      setEmailError('Email address field cannot be empty');
      hasError = true;
    } else if (!EMAIL_REGEX.test(emailVal) || emailVal.length > 254) {
      setEmailError('Enter a valid email address.');
      hasError = true;
    } else {
      setEmailError('');
    }

    if (!passVal) {
      setPasswordError('Password field cannot be empty');
      hasError = true;
    } else {
      setPasswordError('');
    }

    if (hasError) {
      setLiveRegionText('Errors encountered. Please fix the fields.');
      return;
    }

    setIsLoading(true);
    setLiveRegionText('Signing in...');

    fetch('/api/auth/sign-in', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken
      },
      body: JSON.stringify({
        email: emailVal,
        password: passVal,
        csrfToken
      })
    })
      .then((res) => res.json())
      .then((data) => {
        setIsLoading(false);
        if (data.error || !data.success) {
          // Vague error messaging or rate limit notice
          const errMsg = data.error || 'Invalid email or password.';
          setFormAlert(errMsg);
          setLiveRegionText(errMsg);
          return;
        }

        const user = data.user;
        sessionStorage.setItem('auth_active_email', user.email);
        sessionStorage.setItem('auth_user_email', user.email);
        sessionStorage.setItem('auth_user_name', user.name || user.firstName || emailVal.split('@')[0]);
        if (user.id) {
          sessionStorage.setItem('auth_user_id', user.id);
        }

        if (user.isVerified === false) {
          sessionStorage.setItem('pending_verification_email', user.email);
          window.location.href = 'verify-email.html';
        } else {
          window.location.href = 'dashboard.html';
        }
      })
      .catch((err) => {
        setIsLoading(false);
        const errMsg = 'Connection error. Please try again.';
        setFormAlert(errMsg);
        setLiveRegionText(errMsg);
      });
  };

  return (
    <main className="auth-container">
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-subtitle">Welcome back! Please enter your details.</p>
        </header>

        {/* Live announcement region */}
        <div id="status-live-region" className="sr-only" aria-live="polite" aria-atomic="true">
          {liveRegionText}
        </div>

        {/* Flash message banner */}
        {flashMessage && (
          <div id="flash-banner" className={`alert-banner ${flashMessage.alertClass}`} role="status">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
            </svg>
            <span id="flash-text">{flashMessage.text}</span>
          </div>
        )}

        {/* Form-level error banner */}
        {formAlert && (
          <div id="form-alert" className="alert-banner alert-error" role="alert">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
            </svg>
            <span id="form-alert-text">{formAlert}</span>
          </div>
        )}

        <form id="signin-form" className="auth-form" method="POST" onSubmit={handleSubmit} noValidate>
          {/* Email address */}
          <div className="form-group">
            <label htmlFor="email" className="form-label">Email address</label>
            <div className="input-container">
              <input
                type="email"
                id="email"
                name="email"
                autoFocus
                className={`form-input ${emailError ? 'is-invalid' : ''}`}
                required
                maxLength={254}
                autoComplete="email"
                tabIndex={1}
                aria-describedby="email-error"
                aria-invalid={!!emailError}
                value={email}
                onChange={(e) => {
                  const val = e.target.value.toLowerCase();
                  setEmail(val);
                  // State management: collect every email typed so it is automatically input while session is on
                  sessionStorage.setItem('auth_active_email', val);
                  if (emailError) setEmailError('');
                  if (formAlert) setFormAlert('');
                }}
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
                autoComplete="current-password"
                tabIndex={2}
                aria-describedby="password-error"
                aria-invalid={!!passwordError}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError('');
                  if (formAlert) setFormAlert('');
                }}
                onBlur={handlePasswordBlur}
                disabled={isLoading}
              />
              <button
                type="button"
                id="password-toggle"
                className="toggle-password-btn"
                tabIndex={3}
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
            <div id="password-error" className={`field-error ${passwordError ? 'visible' : ''}`} role="alert" aria-live="polite">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <span className="field-error-text">{passwordError}</span>
            </div>
            <div className="forgot-password-row">
              <a href="forgot-password.html" className="auth-link-secondary" tabIndex={4}>Forgot password?</a>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            id="submit-btn"
            className={`btn btn-primary ${isLoading ? 'is-loading' : ''}`}
            tabIndex={5}
            disabled={isLoading}
          >
            <span className="btn-spinner" aria-hidden="true"></span>
            <span id="submit-btn-text">{isLoading ? 'Signing in...' : 'Sign in'}</span>
          </button>
        </form>

        <footer className="auth-footer">
          <p>
            Don't have an account? <a href="sign-up.html" className="auth-link" tabIndex={6}>Create account</a>
          </p>
        </footer>
      </div>
    </main>
  );
}
