import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import tsconfigPaths from 'vite-tsconfig-paths';

const webDirectory = fileURLToPath(new URL('../../../../', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    tailwindcss(),
    solid(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths({ projects: [`${webDirectory}/tsconfig.json`] }),
  ],
  resolve: { dedupe: ['solid-js'] },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    fs: { allow: [webDirectory] },
  },
});
