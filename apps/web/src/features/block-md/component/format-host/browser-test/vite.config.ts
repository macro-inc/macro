import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import overlayConfig from '../../../../../lib/core/component/LexicalMarkdown/editing/browser-test/vite.config';

const directory = fileURLToPath(new URL('.', import.meta.url));
const build = process.env.NATIVE_FORMAT_BUILD;
if (!build) throw new Error('Set an owned NATIVE_FORMAT_BUILD directory');

export default defineConfig({
  ...overlayConfig,
  root: directory,
  plugins: [
    ...(Array.isArray(overlayConfig.plugins) ? overlayConfig.plugins : []),
    {
      name: 'native-formatting-fixture',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return process.env.NATIVE_FORMAT_ENGINE === 'native'
            ? html.replace('./fixture.tsx', './native-fixture.tsx')
            : html;
        },
      },
    },
  ],
  cacheDir: `${build}/cache`,
  build: {
    ...overlayConfig.build,
    outDir: `${build}/dist`,
    rollupOptions: {
      input: { index: `${directory}/index.html` },
    },
  },
  preview: {
    port: Number(process.env.NATIVE_FORMAT_PORT ?? 49507),
    strictPort: true,
  },
});
