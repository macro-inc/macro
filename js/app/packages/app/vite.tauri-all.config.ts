import { defineConfig } from 'vite';
import { createAppViteConfig } from './vite.base.ts';

export default defineConfig(
  createAppViteConfig({ platform: 'tauri-all' })
);
