import '@fontsource-variable/inter';
import '../../../index.css';
import HomeIcon from '@icon/system/regular/house.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { createFeedPreferences } from '../queries/preferences';
import { TEST_ITEMS } from '../tests/fixtures';
import { ForYouView } from '../views/for-you-view';

const IS_LIGHT = new URLSearchParams(location.search).get('theme') === 'light';
document.documentElement.dataset.themeLight = String(IS_LIGHT);
for (const [token, value] of Object.entries(
  (IS_LIGHT ? macroLightTheme : macroDarkTheme).colorTokens
)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

function Fixture() {
  const scenario = new URLSearchParams(location.search).get('scenario');
  const [items, setItems] = createSignal(scenario ? undefined : TEST_ITEMS);
  const [loading, setLoading] = createSignal(scenario === 'loading');
  const [error, setError] = createSignal<string | undefined>(
    scenario === 'error' ? 'unavailable' : undefined
  );
  const [opened, setOpened] = createSignal('');
  const preferences = createFeedPreferences(
    'fixture-user',
    'Keep me focused on the most useful next steps.'
  );
  return (
    <main class="flex h-dvh bg-page p-1.5 font-sans text-ink">
      <aside
        class="flex w-12 shrink-0 justify-center pt-3"
        aria-label="Workspace navigation"
      >
        <HomeIcon class="size-5" />
      </aside>
      <div class="flex min-w-0 flex-1 flex-col rounded-xl border border-edge-muted bg-panel">
        <header class="flex h-12 shrink-0 items-center gap-3 px-4">
          <SidebarIcon class="size-4 text-ink-muted" />
          <span class="text-sm font-medium">Home</span>
          <Button
            as="a"
            href={IS_LIGHT ? '/' : '/?theme=light'}
            variant="ghost"
            size="sm"
            class="ml-auto"
          >
            {IS_LIGHT ? 'Dark appearance' : 'Light appearance'}
          </Button>
        </header>
        <ForYouView
          source={{
            items,
            loading,
            refreshing: () => false,
            error,
            canRetry: () => true,
            refresh: async () => {
              setItems(TEST_ITEMS);
              setLoading(false);
              setError(undefined);
            },
          }}
          preferences={preferences}
          actions={{
            start: async (item) => {
              setOpened(item.prompt);
            },
            openSource: (item) => setOpened(item.sourceEntity?.id ?? ''),
          }}
        />
        <output aria-label="Opened action">{opened()}</output>
      </div>
    </main>
  );
}
const ROOT = document.getElementById('root');
if (ROOT) render(() => <Fixture />, ROOT);
