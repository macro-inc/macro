import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config';

const output =
  process.env.NATIVE_WORD_OUTPUT ??
  join(tmpdir(), 'native-word-navigation-browser');
export default mergeConfig(
  base,
  defineConfig({
    cacheDir: join(output, 'vite-cache'),
    build: { outDir: process.env.NATIVE_WORD_BUILD ?? join(output, 'dist') },
    preview: { port: Number(process.env.NATIVE_WORD_PORT ?? 43627) },
  })
);
