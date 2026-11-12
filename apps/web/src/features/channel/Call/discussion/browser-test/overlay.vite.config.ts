import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type UserConfig } from 'vite';
import { createAppViteConfig } from '../../../../../../vite.base';

const mock = fileURLToPath(
  new URL('./call-overlay-state.tsx', import.meta.url)
);
const baselineOverlay = fileURLToPath(
  new URL('../../__main_CallOverlay.tsx', import.meta.url)
);
const baselinePanel = fileURLToPath(
  new URL('../../chat/components/__main_CallChatPanel.tsx', import.meta.url)
);
const baselineChat = fileURLToPath(
  new URL('../../chat/__main_CallChat.tsx', import.meta.url)
);
const baselineGuestChat = fileURLToPath(
  new URL('../../chat/__main_GuestCallChat.tsx', import.meta.url)
);
export default defineConfig(async (env) => {
  const base = await createAppViteConfig()(env);
  const config: UserConfig = {
    ...base,
    plugins: [
      {
        name: 'call-fixture-boundaries',
        enforce: 'pre',
        resolveId(id, importer) {
          if (id === 'virtual:baseline-call-overlay') return baselineOverlay;
          if (
            importer === baselineOverlay &&
            id === './chat/components/CallChatPanel'
          )
            return baselinePanel;
          if (importer === baselineOverlay && id === './chat/CallChat')
            return baselineChat;
          if (importer === baselineOverlay && id === './chat/GuestCallChat')
            return baselineGuestChat;
          if (!importer) return;
          if (
            importer.includes('/features/channel/Call/') &&
            /(?:^|\/)CallContext$/.test(id)
          )
            return mock;
          if (
            importer.endsWith('/agent-work/views/call-work.tsx') &&
            (id === '@app/lib/analytics/posthog' || id === './use-work-client')
          )
            return mock;
        },
        load(id) {
          // Baseline comparisons exercise member layout; legacy guest chat was removed.
          if (id === baselineGuestChat) return 'export default () => null;';
          const path =
            id === baselineOverlay
              ? 'CallOverlay.tsx'
              : id === baselinePanel
                ? 'chat/components/CallChatPanel.tsx'
                : id === baselineChat
                  ? 'chat/CallChat.tsx'
                  : undefined;
          if (path)
            return execFileSync(
              'git',
              [
                'show',
                `origin/main:apps/web/src/features/channel/Call/${path}`,
              ],
              { encoding: 'utf8' }
            );
        },
      },
      ...(base.plugins ?? []),
    ],
  };
  return config;
});
