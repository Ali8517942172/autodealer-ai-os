import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Single entry. contract-auditor.html was a Tailwind-era standalone page;
      // its function now lives inside the app, so shipping it would mean
      // shipping a second, unstyled copy of the product.
      input: { main: resolve(__dirname, 'index.html') },
    },
  },
  server: { port: 3000 },
});
