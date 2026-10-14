import React from 'react';
import ReactDOM from 'react-dom/client';
import ResetPasswordForm from '../components/ResetPasswordForm.jsx';
import '../../auth.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ResetPasswordForm />
    </React.StrictMode>
  );
}
