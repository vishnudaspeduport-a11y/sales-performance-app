import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode snapshot` produces one self-contained index.html (used by
// scripts/make-snapshot.mjs to create shareable previews with embedded data).
export default defineConfig(({ mode }) => ({
  plugins: mode === 'snapshot' ? [react(), viteSingleFile()] : [react()],
  build: {
    outDir: mode === 'snapshot' ? 'dist-snapshot' : 'dist',
    sourcemap: false,
    cssCodeSplit: mode !== 'snapshot',
    assetsInlineLimit: mode === 'snapshot' ? 100000000 : 4096,
    reportCompressedSize: false,
    rollupOptions: mode === 'snapshot' ? {} : {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // Local API (scripts/dev-api.mjs) mirrors the Netlify functions.
    proxy: { '/api': 'http://localhost:8787' },
  },
}));
