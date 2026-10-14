import { defineConfig } from 'vite';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { handleAuthApiRequest } = require('./src/server/api.js');

export default defineConfig({
  server: {
    port: 5173,
    open: '/sign-in.html'
  },
  plugins: [
    react(),
    {
      name: 'auth-api-and-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.startsWith('/api/')) {
            try {
              delete require.cache[require.resolve('./src/server/api.js')];
              delete require.cache[require.resolve('./src/server/auth.service.js')];
            } catch (_) {}
            const { handleAuthApiRequest: freshHandler } = require('./src/server/api.js');
            freshHandler(req, res, next);
            return;
          }
          if (req.url === '/' || req.url === '/index.html') {
            res.writeHead(302, { Location: '/sign-in.html' });
            res.end();
            return;
          }
          next();
        });
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        signIn: resolve(import.meta.dirname, 'sign-in.html'),
        signUp: resolve(import.meta.dirname, 'sign-up.html'),
        forgotPassword: resolve(import.meta.dirname, 'forgot-password.html'),
        resetPassword: resolve(import.meta.dirname, 'reset-password.html'),
        verifyEmail: resolve(import.meta.dirname, 'verify-email.html'),
        dashboard: resolve(import.meta.dirname, 'dashboard.html')
      }
    }
  }
});
