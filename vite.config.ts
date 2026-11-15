import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The hub listens on this port (docs/ARCHITECTURE.md). In dev, Vite serves the web app
// and forwards API and auth requests to the hub. The proxy pipes responses as they
// arrive and Vite does not compress proxied responses, so /api/events streams unbuffered.
const hub = 'http://127.0.0.1:7420';
// The hub only accepts its own origin on mutating requests, so present the hub origin.
const asHub = { target: hub, changeOrigin: true, headers: { origin: hub } };

export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': asHub,
      '/auth': asHub,
    },
  },
});
