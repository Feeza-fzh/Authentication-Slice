import React from 'react';
import ReactDOM from 'react-dom/client';
import VerifyEmailForm from '../components/VerifyEmailForm.jsx';
import '../../auth.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <VerifyEmailForm />
    </React.StrictMode>
  );
}
