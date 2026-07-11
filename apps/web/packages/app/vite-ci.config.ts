import { defineConfig } from 'vite';

// intended for using Vite's preview only without any depdencies other than vite itself
export default defineConfig(() => ({
  base: '/app',
  preview: {
    port: 3000,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true as const,
    cors: true,
  },
}));
