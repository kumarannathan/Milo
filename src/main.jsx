import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/components.css';
import './styles/app.css';
import { App } from './App.jsx';
import { AppProvider } from './lib/app-context.jsx';
import { AuthProvider } from './lib/auth.jsx';
import { ToastProvider } from './components/feedback.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>,
);
