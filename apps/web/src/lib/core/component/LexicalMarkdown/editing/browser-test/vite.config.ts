import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url));
const WEB_DIRECTORY = fileURLToPath(
  new URL('../../../../../../../', import.meta.url)
);

export default defineConfig({
  root: DIRECTORY,
  cacheDir: `${WEB_DIRECTORY}/node_modules/.vite-native-overlays`,
  plugins: [
    tailwind(),
    tsconfigPaths({ projects: [`${WEB_DIRECTORY}/tsconfig.json`] }),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    wasm(),
  ],
  resolve: { dedupe: ['solid-js'] },
  build: {
    target: 'es2022',
    outDir: `${WEB_DIRECTORY}/node_modules/.native-overlays-dist`,
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.NATIVE_OVERLAYS_PORT ?? 43583),
    strictPort: true,
  },
});
