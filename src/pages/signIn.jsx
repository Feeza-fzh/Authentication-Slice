import React from 'react';
import ReactDOM from 'react-dom/client';
import SignInForm from '../components/SignInForm.jsx';
import '../../auth.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <SignInForm />
    </React.StrictMode>
  );
}
