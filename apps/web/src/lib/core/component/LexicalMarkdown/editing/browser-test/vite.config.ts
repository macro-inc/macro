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
  define: {
    'import.meta.env.VITE_LOCAL_SERVERS': JSON.stringify('ALL'),
    'import.meta.env.VITE_LOCAL_BACKEND_ORIGIN': JSON.stringify('same-origin'),
  },
  cacheDir: `${WEB_DIRECTORY}/node_modules/.vite-native-overlays`,
  plugins: [
    {
      name: 'local-overlay-fixture-analytics',
      transform(code, id) {
        if (!id.endsWith('/src/lib/analytics/providers.ts')) return;
        return {
          code: code
            .replaceAll(
              'https://www.googletagmanager.com/gtag/js',
              '/__fixture/analytics/google-tag.js'
            )
            .replaceAll(
              'https://www.googletagmanager.com/gtm.js',
              '/__fixture/analytics/google-manager.js'
            )
            .replaceAll(
              'https://connect.facebook.net/en_US/fbevents.js',
              '/__fixture/analytics/meta.js'
            )
            .replaceAll(
              'https://www.facebook.com/tr',
              '/__fixture/analytics/pixel.gif'
            ),
          map: null,
        };
      },
      generateBundle() {
        for (const fileName of [
          'google-tag.js',
          'google-manager.js',
          'meta.js',
        ]) {
          this.emitFile({
            type: 'asset',
            fileName: '__fixture/analytics/' + fileName,
            source: '/* Local fixture analytics transport. */',
          });
        }
        this.emitFile({
          type: 'asset',
          fileName: '__fixture/analytics/pixel.gif',
          source: Uint8Array.from([
            71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255,
            255, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2,
            68, 1, 0, 59,
          ]),
        });
      },
    },
    tailwind(),
    tsconfigPaths({ projects: [`${WEB_DIRECTORY}/tsconfig.json`] }),
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    wasm(),
  ],
  worker: {
    format: 'es',
    plugins: () => [
      tsconfigPaths({ projects: [`${WEB_DIRECTORY}/tsconfig.json`] }),
      wasm(),
    ],
  },
  resolve: { dedupe: ['solid-js'] },
  build: {
    target: 'es2022',
    outDir: `${WEB_DIRECTORY}/node_modules/.native-overlays-dist`,
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: `${DIRECTORY}/index.html`,
        userMentions: `${DIRECTORY}/user-mentions.html`,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: Number(process.env.NATIVE_OVERLAYS_PORT ?? 43583),
    strictPort: true,
  },
});
