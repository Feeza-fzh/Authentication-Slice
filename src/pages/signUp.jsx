import React from 'react';
import ReactDOM from 'react-dom/client';
import SignUpForm from '../components/SignUpForm.jsx';
import '../../auth.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <SignUpForm />
    </React.StrictMode>
  );
}
