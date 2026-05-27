import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Knit dashboard — local-first analytics on top of ~/.knit/.
// Vite dev server proxies /api/* to the Knit dashboard server (port 7421).
// In production, `knit dashboard` builds the static bundle and serves it
// from the same Express process that exposes /api/*, so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 7420,
    proxy: {
      '/api': {
        target: 'http://localhost:7421',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
