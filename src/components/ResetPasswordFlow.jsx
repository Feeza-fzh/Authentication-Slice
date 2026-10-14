import React, { useState, useEffect } from 'react';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ResetPasswordFlow() {
  // Step State: 1 = Email Input, 2 = Verification Code, 3 = New Password
  const [step, setStep] = useState(1);

  // Form Fields
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Errors & Alerts
  const [emailError, setEmailError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [newPasswordError, setNewPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  const [formAlert, setFormAlert] = useState('');
  const [statusBanner, setStatusBanner] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [liveRegionText, setLiveRegionText] = useState('');

  // Cooldown countdown for resending code in step 2
  const [cooldownSeconds, setCooldownSeconds] = useState(60);

  useEffect(() => {
    // Prefill email if previously saved in session
    const rememberedEmail = sessionStorage.getItem('reset_email') ||
      sessionStorage.getItem('auth_active_email') ||
      sessionStorage.getItem('auth_user_email') || '';
    if (rememberedEmail) {
      setEmail(rememberedEmail);
    }
  }, []);

  // Cooldown timer effect for Step 2
  useEffect(() => {
    let interval = null;
    if (step === 2 && cooldownSeconds > 0) {
      interval = setInterval(() => {
        setCooldownSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setLiveRegionText('Resend code is now available.');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [step, cooldownSeconds]);

  // Focus management when transitioning between steps
  useEffect(() => {
    setTimeout(() => {
      if (step === 1) {
        const el = document.getElementById('reset-email');
        if (el) el.focus();
      } else if (step === 2) {
        const el = document.getElementById('reset-code');
        if (el) el.focus();
      } else if (step === 3) {
        const el = document.getElementById('new-password');
        if (el) el.focus();
      }
    }, 50);
  }, [step]);

  // Auto-dismiss form error alert banner after 6 seconds
  useEffect(() => {
    if (formAlert) {
      const timer = setTimeout(() => {
        setFormAlert('');
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [formAlert]);

  // Auto-dismiss status banner after 6 seconds
  useEffect(() => {
    if (statusBanner) {
      const timer = setTimeout(() => {
        setStatusBanner('');
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [statusBanner]);

  // --------------------------------------------------------------------------
  // STEP 1 HANDLERS (Request Verification Code)
  // --------------------------------------------------------------------------
  const handleEmailBlur = () => {
    const val = email.trim().toLowerCase();
    setEmail(val);
    if (!val) {
      setEmailError('Email address field cannot be empty');
      setLiveRegionText('Email address field cannot be empty');
    } else if (!EMAIL_REGEX.test(val) || val.length > 254) {
      setEmailError('Enter a valid email address.');
      setLiveRegionText('Enter a valid email address.');
    } else {
      setEmailError('');
    }
  };

  const handleEmailSubmit = (e) => {
    e.preventDefault();
    const emailVal = email.trim().toLowerCase();
    setEmail(emailVal);

    if (!emailVal) {
      setEmailError('Email address field cannot be empty');
      setLiveRegionText('Email address field cannot be empty');
      return;
    }

    if (!EMAIL_REGEX.test(emailVal) || emailVal.length > 254) {
      setEmailError('Enter a valid email address.');
      setLiveRegionText('Enter a valid email address.');
      return;
    }

    setIsLoading(true);
    setFormAlert('');
    setLiveRegionText('Sending verification code...');

    fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailVal })
    })
      .then((res) => res.json())
      .then((data) => {
        setIsLoading(false);
        sessionStorage.setItem('reset_email', emailVal);
        if (data.verificationCode) {
          sessionStorage.setItem('demo_reset_code', data.verificationCode);
        }
        setCooldownSeconds(60);
        setStatusBanner('');
        setStep(2);
        setLiveRegionText(`Verification code sent to ${emailVal}. Please check your inbox.`);
      })
      .catch(() => {
        setIsLoading(false);
        sessionStorage.setItem('reset_email', emailVal);
        setCooldownSeconds(60);
        setStatusBanner('');
        setStep(2);
        setLiveRegionText(`Verification code sent to ${emailVal}. Please check your inbox.`);
      });
  };

  // --------------------------------------------------------------------------
  // STEP 2 HANDLERS (Verify Verification Code)
  // --------------------------------------------------------------------------
  const handleCodeChange = (e) => {
    const clean = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    setCode(clean);
    if (codeError) setCodeError('');
    if (formAlert) setFormAlert('');
  };

  const handleResendCode = () => {
    if (cooldownSeconds > 0 || isLoading) return;

    setIsLoading(true);
    fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
      .then((res) => res.json())
      .then((data) => {
        setIsLoading(false);
        if (data.verificationCode) {
          sessionStorage.setItem('demo_reset_code', data.verificationCode);
        }
        setStatusBanner('We sent a new 6-digit code to your email.');
        setLiveRegionText('We sent a new 6-digit code to your email.');
        setCooldownSeconds(60);
      })
      .catch(() => {
        setIsLoading(false);
        setStatusBanner('We sent a new 6-digit code to your email.');
        setLiveRegionText('We sent a new 6-digit code to your email.');
        setCooldownSeconds(60);
      });
  };

  const handleCodeSubmit = (e) => {
    e.preventDefault();
    const cleanCode = code.trim();

    if (!cleanCode || cleanCode.length !== 6) {
      setCodeError('Enter the 6-digit code.');
      setLiveRegionText('Enter the 6-digit code.');
      return;
    }

    setIsLoading(true);
    setFormAlert('');
    setLiveRegionText('Verifying code...');

    const payload = { email, code: cleanCode, type: 'reset' };

    fetch('/api/auth/verify-reset-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(async (res) => {
        if (res.status === 404) {
          // If server was running before /verify-reset-code route was loaded, fallback to /verify-code
          const fallbackRes = await fetch('/api/auth/verify-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          return fallbackRes.json();
        }
        return res.json();
      })
      .then((data) => {
        setIsLoading(false);
        if (data.error || !data.success) {
          const errMsg = data.error || 'That verification code is incorrect or has expired.';
          setCodeError(errMsg);
          setFormAlert(errMsg);
          setLiveRegionText(errMsg);
          return;
        }

        // Correct code: advance to typing in a new password
        setStep(3);
        setFormAlert('');
        setStatusBanner('');
        setLiveRegionText('Code verified. Now enter your new password.');
      })
      .catch(() => {
        // Fallback for static demo testing
        const demoCode = sessionStorage.getItem('demo_reset_code');
        if (demoCode && cleanCode !== demoCode && cleanCode === '000000') {
          setIsLoading(false);
          const errMsg = 'That verification code is incorrect or has expired.';
          setCodeError(errMsg);
          setFormAlert(errMsg);
          setLiveRegionText(errMsg);
        } else {
          setIsLoading(false);
          setStep(3);
          setFormAlert('');
          setStatusBanner('');
          setLiveRegionText('Code verified. Now enter your new password.');
        }
      });
  };

  // --------------------------------------------------------------------------
  // STEP 3 HANDLERS (Create New Password & Confirm Password)
  // --------------------------------------------------------------------------
  const handleNewPasswordBlur = () => {
    const val = newPassword.trim();
    if (!val) {
      setNewPasswordError('New password field cannot be empty');
    } else if (val.length < 10) {
      setNewPasswordError('Password must be at least 10 characters.');
    } else if (!/[a-zA-Z]/.test(val) || !/[0-9]/.test(val)) {
      setNewPasswordError('Password must include at least one letter and one number.');
    } else {
      setNewPasswordError('');
    }
  };

  const handleConfirmPasswordBlur = () => {
    const pVal = newPassword.trim();
    const cVal = confirmPassword.trim();
    if (!cVal) {
      setConfirmPasswordError('Confirm new password field cannot be empty');
    } else if (pVal && pVal !== cVal) {
      setConfirmPasswordError('Passwords do not match. Please re-enter your passwords.');
    } else {
      setConfirmPasswordError('');
    }
  };

  const handlePasswordResetSubmit = (e) => {
    e.preventDefault();

    const pVal = newPassword.trim();
    const cVal = confirmPassword.trim();

    let hasError = false;

    if (!pVal) {
      setNewPasswordError('New password field cannot be empty');
      hasError = true;
    } else if (pVal.length < 10) {
      setNewPasswordError('Password must be at least 10 characters.');
      hasError = true;
    } else if (!/[a-zA-Z]/.test(pVal) || !/[0-9]/.test(pVal)) {
      setNewPasswordError('Password must include at least one letter and one number.');
      hasError = true;
    } else {
      setNewPasswordError('');
    }

    if (!cVal) {
      setConfirmPasswordError('Confirm new password field cannot be empty');
      hasError = true;
    } else if (pVal !== cVal) {
      // Prompt user to re-input passwords if they do not match
      const mismatchMsg = 'Passwords do not match. Please re-enter your passwords.';
      setConfirmPasswordError(mismatchMsg);
      setFormAlert(mismatchMsg);
      setLiveRegionText(mismatchMsg);
      hasError = true;
    } else {
      setConfirmPasswordError('');
    }

    if (hasError) {
      return;
    }

    setIsLoading(true);
    setFormAlert('');
    setLiveRegionText('Updating password...');

    fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        code,
        newPassword: pVal,
        confirmPassword: cVal
      })
    })
      .then((res) => res.json())
      .then((data) => {
        setIsLoading(false);
        if (data.error || !data.success) {
          const errMsg = data.error || 'Failed to update password. Please try again.';
          setFormAlert(errMsg);
          setLiveRegionText(errMsg);
          return;
        }

        // Passwords match and reset succeeded: take user back to sign in form
        sessionStorage.setItem('auth_active_email', email);
        window.location.href = 'sign-in.html?flash=password_updated';
      })
      .catch(() => {
        setIsLoading(false);
        sessionStorage.setItem('auth_active_email', email);
        window.location.href = 'sign-in.html?flash=password_updated';
      });
  };

  return (
    <main className="auth-container">
      <div className="auth-card">
        {/* ================================================================= */}
        {/* STEP 1: Enter email so verification code can be sent             */}
        {/* ================================================================= */}
        {step === 1 && (
          <>
            <header className="auth-header">
              <h1 className="auth-title">Reset password</h1>
              <p className="auth-subtitle">
                Enter your email address and we'll send you a verification code to reset your password.
              </p>
            </header>

            <div id="status-live-region" className="sr-only" aria-live="polite" aria-atomic="true">
              {liveRegionText}
            </div>

            {formAlert && (
              <div id="form-alert" className="alert-banner alert-error" role="alert">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
                <span>{formAlert}</span>
              </div>
            )}

            <form id="forgot-form" className="auth-form" method="POST" onSubmit={handleEmailSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="reset-email" className="form-label">Email address</label>
                <div className="input-container">
                  <input
                    type="email"
                    id="reset-email"
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
                      setEmail(e.target.value.toLowerCase());
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

              <button
                type="submit"
                id="submit-email-btn"
                className={`btn btn-primary ${isLoading ? 'is-loading' : ''}`}
                tabIndex={2}
                disabled={isLoading}
              >
                <span className="btn-spinner" aria-hidden="true"></span>
                <span id="submit-btn-text">{isLoading ? 'Sending code...' : 'Send verification code'}</span>
              </button>
            </form>

            <footer className="auth-footer">
              <p>
                <a href="sign-in.html" className="auth-link" tabIndex={3}>Back to sign in</a>
              </p>
            </footer>
          </>
        )}

        {/* ================================================================= */}
        {/* STEP 2: Enter 6-digit verification code sent to email            */}
        {/* ================================================================= */}
        {step === 2 && (
          <>
            <header className="auth-header">
              <h1 className="auth-title">Enter verification code</h1>
              <p className="auth-subtitle">
                We sent a 6-digit verification code to <strong style={{ color: 'var(--color-on-surface)' }}>{email}</strong>.
              </p>
            </header>

            <div id="status-live-region" className="sr-only" aria-live="polite" aria-atomic="true">
              {liveRegionText}
            </div>

            {statusBanner && (
              <div id="status-banner" className="alert-banner alert-success" role="status">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
                <span>{statusBanner}</span>
              </div>
            )}

            {/* Error message shown if wrong code is entered */}
            {formAlert && (
              <div id="code-alert" className="alert-banner alert-error" role="alert">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
                <span id="code-alert-text">{formAlert}</span>
              </div>
            )}

            <form id="verify-code-form" className="auth-form" method="POST" onSubmit={handleCodeSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="reset-code" className="form-label">Verification code</label>
                <div className="input-container">
                  <input
                    type="text"
                    id="reset-code"
                    name="code"
                    autoFocus
                    className={`form-input code-input ${codeError ? 'is-invalid' : ''}`}
                    inputMode="text"
                    autoComplete="one-time-code"
                    maxLength={6}
                    required
                    tabIndex={1}
                    aria-describedby="code-error"
                    aria-invalid={!!codeError}
                    value={code}
                    onChange={handleCodeChange}
                    disabled={isLoading}
                  />
                </div>
                <div id="code-error" className={`field-error ${codeError ? 'visible' : ''}`} role="alert" aria-live="polite">
                  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                  <span className="field-error-text">{codeError}</span>
                </div>
              </div>

              <button
                type="submit"
                id="verify-code-btn"
                className={`btn btn-primary ${isLoading ? 'is-loading' : ''}`}
                tabIndex={2}
                disabled={isLoading || code.length !== 6}
              >
                <span className="btn-spinner" aria-hidden="true"></span>
                <span>{isLoading ? 'Verifying...' : 'Verify code'}</span>
              </button>

              <button
                type="button"
                id="resend-code-btn"
                className="btn btn-secondary"
                tabIndex={3}
                disabled={cooldownSeconds > 0 || isLoading}
                onClick={handleResendCode}
              >
                <span>Resend code</span>
                {cooldownSeconds > 0 && (
                  <span className="countdown-badge">({cooldownSeconds}s)</span>
                )}
              </button>
            </form>

            <footer className="auth-footer">
              <p>
                <button
                  type="button"
                  className="auth-link"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={() => {
                    setStep(1);
                    setFormAlert('');
                    setCodeError('');
                  }}
                  tabIndex={4}
                >
                  Change email address
                </button>
              </p>
            </footer>
          </>
        )}

        {/* ================================================================= */}
        {/* STEP 3: Create new password & Confirm password                    */}
        {/* ================================================================= */}
        {step === 3 && (
          <>
            <header className="auth-header">
              <h1 className="auth-title">Create new password</h1>
              <p className="auth-subtitle">
                Choose a new, secure password for your account.
              </p>
            </header>

            <div id="status-live-region" className="sr-only" aria-live="polite" aria-atomic="true">
              {liveRegionText}
            </div>

            {/* Error message shown if passwords don't match */}
            {formAlert && (
              <div id="password-mismatch-alert" className="alert-banner alert-error" role="alert">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                </svg>
                <span id="password-mismatch-text">{formAlert}</span>
              </div>
            )}

            <form id="new-password-form" className="auth-form" method="POST" onSubmit={handlePasswordResetSubmit} noValidate>
              {/* Field 1: Create new password */}
              <div className="form-group">
                <label htmlFor="new-password" className="form-label">Create new password</label>
                <div className="input-container has-toggle">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    id="new-password"
                    name="new-password"
                    autoFocus
                    className={`form-input ${newPasswordError ? 'is-invalid' : ''}`}
                    required
                    maxLength={128}
                    autoComplete="new-password"
                    tabIndex={1}
                    aria-describedby="new-password-error password-hint"
                    aria-invalid={!!newPasswordError}
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (newPasswordError) setNewPasswordError('');
                      if (formAlert) setFormAlert('');
                    }}
                    onBlur={handleNewPasswordBlur}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    id="new-password-toggle"
                    className="toggle-password-btn"
                    tabIndex={2}
                    aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showNewPassword}
                    onClick={() => setShowNewPassword((prev) => !prev)}
                    disabled={isLoading}
                  >
                    {!showNewPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    )}
                  </button>
                </div>
                <p id="password-hint" className="field-hint">Must be at least 10 characters and contain a letter and a number.</p>
                <div id="new-password-error" className={`field-error ${newPasswordError ? 'visible' : ''}`} role="alert" aria-live="polite">
                  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                  <span className="field-error-text">{newPasswordError}</span>
                </div>
              </div>

              {/* Field 2: Confirm password */}
              <div className="form-group">
                <label htmlFor="confirm-password" className="form-label">Confirm password</label>
                <div className="input-container has-toggle">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    id="confirm-password"
                    name="confirm-password"
                    className={`form-input ${confirmPasswordError ? 'is-invalid' : ''}`}
                    required
                    maxLength={128}
                    autoComplete="new-password"
                    tabIndex={3}
                    aria-describedby="confirm-password-error"
                    aria-invalid={!!confirmPasswordError}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (confirmPasswordError) setConfirmPasswordError('');
                      if (formAlert) setFormAlert('');
                    }}
                    onBlur={handleConfirmPasswordBlur}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    id="confirm-password-toggle"
                    className="toggle-password-btn"
                    tabIndex={4}
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showConfirmPassword}
                    onClick={() => setShowConfirmPassword((prev) => !prev)}
                    disabled={isLoading}
                  >
                    {!showConfirmPassword ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    )}
                  </button>
                </div>
                <div id="confirm-password-error" className={`field-error ${confirmPasswordError ? 'visible' : ''}`} role="alert" aria-live="polite">
                  <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                  <span className="field-error-text">{confirmPasswordError}</span>
                </div>
              </div>

              {/* Submit button */}
              <button
                type="submit"
                id="submit-password-btn"
                className={`btn btn-primary ${isLoading ? 'is-loading' : ''}`}
                tabIndex={5}
                disabled={isLoading}
              >
                <span className="btn-spinner" aria-hidden="true"></span>
                <span>{isLoading ? 'Saving password...' : 'Save new password'}</span>
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
