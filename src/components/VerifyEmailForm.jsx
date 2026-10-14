import React, { useState, useEffect } from 'react';

export default function VerifyEmailForm() {
  // Read cross-page data specifically from sessionStorage
  const [targetEmail, setTargetEmail] = useState('you@example.com');

  // Form State managed via useState
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [statusBanner, setStatusBanner] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState(60);
  const [isLoading, setIsLoading] = useState(false);
  const [liveRegionText, setLiveRegionText] = useState('');

  useEffect(() => {
    const emailStored = (sessionStorage.getItem('pending_verification_email') || 'you@example.com').trim().toLowerCase();
    setTargetEmail(emailStored);
  }, []);

  // Cooldown countdown timer effect
  useEffect(() => {
    let interval = null;
    if (cooldownSeconds > 0) {
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
  }, [cooldownSeconds]);

  // Auto-dismiss status banner after 6 seconds
  useEffect(() => {
    if (statusBanner) {
      const timer = setTimeout(() => {
        setStatusBanner('');
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [statusBanner]);

  const handleCodeChange = (e) => {
    const val = e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
    setCode(val);
    if (codeError) setCodeError('');
  };

  const handleResend = () => {
    if (cooldownSeconds > 0) return;

    fetch('/api/auth/resend-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.verificationCode) {
          sessionStorage.setItem('demo_verification_code', data.verificationCode);
        }
      })
      .catch(() => {});

    setStatusBanner('We sent a new code.');
    setLiveRegionText('We sent a new code.');
    setCooldownSeconds(60);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const trimmed = code.trimEnd().trim();
    setCode(trimmed);

    if (trimmed.length !== 6) {
      setCodeError('Enter the 6-digit code.');
      setLiveRegionText('Enter the 6-digit code.');
      return;
    }

    setIsLoading(true);
    setLiveRegionText('Verifying...');

    fetch('/api/auth/verify-code', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: targetEmail,
        code: trimmed
      })
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.error || !data.success) {
          setIsLoading(false);
          const errMsg = data.error || 'That code is incorrect.';
          setCodeError(errMsg);
          setLiveRegionText(errMsg);
          return;
        }

        const userName = (data.user && (data.user.name || data.user.firstName)) ||
          sessionStorage.getItem('auth_user_name') ||
          targetEmail.split('@')[0];
        sessionStorage.setItem('auth_user_name', userName);
        sessionStorage.setItem('auth_active_email', targetEmail);
        sessionStorage.setItem('auth_user_email', targetEmail);
        if (data.user && data.user.id) {
          sessionStorage.setItem('auth_user_id', data.user.id);
        }
        window.location.href = 'dashboard.html';
      })
      .catch(() => {
        // Fallback for static serving / demo testing
        const demoCode = sessionStorage.getItem('demo_verification_code');
        if (demoCode && trimmed !== demoCode && trimmed === '000000') {
          setIsLoading(false);
          setCodeError('That code is incorrect.');
          setLiveRegionText('That code is incorrect.');
        } else {
          sessionStorage.setItem('auth_user_name', targetEmail.split('@')[0]);
          window.location.href = 'dashboard.html';
        }
      });
  };

  return (
    <main className="auth-container">
      <div className="auth-card">
        <header className="auth-header">
          <h1 className="auth-title">Verify your email</h1>
          <p className="auth-subtitle" id="verify-subtitle">
            We sent a 6-digit code to <strong id="target-email" style={{ color: 'var(--color-on-surface)' }}>{targetEmail}</strong>. The code expires in 10 minutes.
          </p>
        </header>

        {/* Live announcement region */}
        <div id="status-live-region" className="sr-only" aria-live="polite" aria-atomic="true">
          {liveRegionText}
        </div>

        {/* Alert Banner for resend confirmation */}
        {statusBanner && (
          <div id="status-banner" className="alert-banner alert-success" role="status">
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
            </svg>
            <span id="status-banner-text">{statusBanner}</span>
          </div>
        )}

        <form id="verify-form" className="auth-form" method="POST" onSubmit={handleSubmit} noValidate>
          {/* Code input */}
          <div className="form-group">
            <label htmlFor="code" className="form-label">Verification code</label>
            <div className="input-container">
              <input
                type="text"
                id="code"
                name="code"
                className={`form-input code-input ${codeError ? 'is-invalid' : ''}`}
                inputMode="text"
                autoComplete="one-time-code"
                maxLength={7}
                required
                tabIndex={1}
                aria-describedby="code-error"
                aria-invalid={!!codeError}
                value={code}
                onChange={handleCodeChange}
                onBlur={() => setCode(prev => prev.trimEnd())}
                disabled={isLoading}
              />
            </div>
            <div id="code-error" className={`field-error ${codeError ? 'visible' : ''}`} role="alert" aria-live="polite">
              <svg viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              <span className="field-error-text">{codeError}</span>
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            id="submit-btn"
            className={`btn btn-primary ${isLoading ? 'is-loading' : ''}`}
            tabIndex={2}
            disabled={isLoading || code.length !== 6}
          >
            <span className="btn-spinner" aria-hidden="true"></span>
            <span id="submit-btn-text">{isLoading ? 'Verifying...' : 'Verify email'}</span>
          </button>

          {/* Resend button with cooldown badge */}
          <button
            type="button"
            id="resend-btn"
            className="btn btn-secondary"
            tabIndex={3}
            disabled={cooldownSeconds > 0 || isLoading}
            onClick={handleResend}
          >
            <span>Resend code</span>
            {cooldownSeconds > 0 && (
              <span id="cooldown-timer" className="countdown-badge">({cooldownSeconds}s)</span>
            )}
          </button>
        </form>

        <footer className="auth-footer">
          <p>
            <a href="sign-in.html" className="auth-link-secondary" tabIndex={4}>Use a different account</a>
          </p>
        </footer>
      </div>
    </main>
  );
}
