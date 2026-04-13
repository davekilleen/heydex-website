import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        constellationAmbientPreview: path.resolve(
          __dirname,
          'constellation-ambient-preview.html',
        ),
        paperHeroVariantDPreview: path.resolve(
          __dirname,
          'paper-hero-variant-d-preview.html',
        ),
      },
    },
  },
  // Support importing from generated Convex files
  resolve: {
    alias: {},
  },
});
