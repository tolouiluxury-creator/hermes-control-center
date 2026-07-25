import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The production bundle is emitted into the published package (../dist/web) so the
 * Fastify server can serve it as a static SPA. In dev, Vite owns the browser and
 * proxies /api to the control-center server.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7777',
        changeOrigin: false,
        ws: false,
      },
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 700,
  },
});
