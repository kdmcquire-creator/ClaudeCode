import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the service worker so the PWA gets offline support,
// app-badge counts, and push notifications.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('Service worker registered:', registration.scope);

        // Request periodic background sync for badge updates (Chrome/Edge)
        if ('periodicSync' in registration) {
          registration.periodicSync
            .register('update-badge', { minInterval: 15 * 60 * 1000 }) // 15 min
            .catch(() => { /* periodicSync not granted — badge will update on open */ });
        }
      })
      .catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
  });
}
