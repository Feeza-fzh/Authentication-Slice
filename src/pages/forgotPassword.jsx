import React from 'react';
import ReactDOM from 'react-dom/client';
import ForgotPasswordForm from '../components/ForgotPasswordForm.jsx';
import '../../auth.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ForgotPasswordForm />
    </React.StrictMode>
  );
}
