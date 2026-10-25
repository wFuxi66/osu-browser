/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // ffmpeg.wasm spawns its own worker by a relative URL, which pre-bundling would break.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg'] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  // reference/ holds local, gitignored material (screenshots, downloaded maps, scratch checks).
  test: { exclude: ['**/node_modules/**', 'reference/**'] },
});
