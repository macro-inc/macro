import { resolve } from 'node:path';
import tailwind from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import solidSvg from 'vite-plugin-solid-svg';
import wasm from 'vite-plugin-wasm';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    {
      name: 'recording-view-fixture-adapters',
      enforce: 'pre',
      resolveId(source, importer) {
        if (
          importer?.endsWith('/side-panel/SidePanel.tsx') &&
          [
            '@core/block',
            '@app/preferences/use-preference',
            '@core/hotkey/hotkeys',
            '../split-layout/layoutUtils',
            '../split-layout/components/SplitHeader',
            '../split-layout/components/HeaderIsland',
            '@core/component/Resize/Resize',
          ].includes(source)
        )
          return resolve(
            'src/features/block-call/browser-test/view-adapters.tsx'
          );
        if (source === '@components/app/side-panel')
          return resolve('src/components/app/side-panel/SidePanel.tsx');
        if (!importer?.includes('/features/block-call/')) return;
        if (
          [
            '@channel/Call/CallContext',
            '../use-call-again',
            '@app/features/chat/ChatWithAgentButton',
            '@property/tags',
            '@core/component/CustomScrollbar',
            '@channel/Call/chat/CallChatHistory',
            '@channel/Message',
            '@channel/Message/SenderName',
            '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
            './CallRecordingChat',
            './CallRecordingMobileActions',
            './CallRecordingMobilePlayback',
          ].includes(source)
        )
          return resolve(
            'src/features/block-call/browser-test/view-adapters.tsx'
          );
      },
    },
    solidPlugin(),
    solidSvg({ defaultAsComponent: true }),
    tsconfigPaths(),
    tailwind(),
    wasm(),
  ],
  resolve: { dedupe: ['solid-js', 'loro-crdt'] },
  build: {
    target: 'esnext',
    outDir: 'node_modules/.cache/call-playback-browser',
    emptyOutDir: true,
    rollupOptions: {
      input: ['playback', 'view'].map((name) =>
        resolve(`src/features/block-call/browser-test/${name}.html`)
      ),
    },
  },
  worker: { format: 'es' },
});
