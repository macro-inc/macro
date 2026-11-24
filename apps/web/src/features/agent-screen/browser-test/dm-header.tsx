import '@fontsource-variable/inter';
import '@app/index.css';
import { ChannelDetailTopBar } from '@channel/Channel/ChannelDetail';
import { ChannelTabProvider } from '@channel/Channel/ChannelTabContext';
import type { ChannelTabId } from '@channel/Channel/channel-tabs';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { CHANNEL_ID } from './stubs/dm';

/**
 * The real DM top bar (`ChannelDetailTopBar`) for a DM with an agent
 * teammate whose computer is offline; `stubs/` stand in for the queries.
 * `?width=<px>` sizes the pane, `?theme=dark`.
 */
const params = new URLSearchParams(location.search);
document.documentElement.dataset.themeLight = String(
  params.get('theme') !== 'dark'
);
const theme = params.get('theme') === 'dark' ? macroDarkTheme : macroLightTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

// Nothing here may reach a backend.
const queryClient = new QueryClient({
  defaultOptions: { queries: { enabled: false, retry: false } },
});

function Fixture() {
  const [tab, setTab] = createSignal<ChannelTabId>('messages');
  return (
    <div class="min-h-screen bg-page p-4 text-ink">
      <div
        data-testid="pane"
        class="overflow-hidden rounded-xl border border-edge-frame bg-panel"
        style={{ width: `${params.get('width') ?? 600}px` }}
      >
        <ChannelTabProvider activeTab={tab} setActiveTab={setTab}>
          <ChannelDetailTopBar channelId={CHANNEL_ID} fallbackName="Eve" />
        </ChannelTabProvider>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Fixture />
      </QueryClientProvider>
    ),
    root
  );
