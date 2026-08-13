import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Unregister Service Workers and clear caches to prevent blank screen from stale bundles
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister().then((success) => {
        if (success) {
          console.log('[PWA] Stale Service Worker unregistered.');
          // Avoid window.location.reload() here to prevent infinite reload loops in sandboxed environments
        }
      });
    }
  }).catch((err) => {
    console.error('[PWA] Error unregistering service workers:', err);
  });
}

if ('caches' in window) {
  caches.keys().then((keys) => {
    Promise.all(keys.map(key => caches.delete(key))).then(() => {
      console.log('[PWA] Stale caches cleared.');
    });
  }).catch((err) => {
    console.error('[PWA] Error clearing caches:', err);
  });
}
