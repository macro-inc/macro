import '@fontsource-variable/inter';
import '../../../index.css';
import HomeIcon from '@icon/system/regular/house.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { FeedItem } from '../../for-you/core/feed';
import { createFeedPreferences } from '../../for-you/queries/preferences';
import { TEST_ITEMS } from '../../for-you/tests/fixtures';
import { ForYouView } from '../../for-you/views/for-you-view';
import { macroDarkTheme } from '../../theme/themes/macro-dark';
import { macroLightTheme } from '../../theme/themes/macro-light';
import { HomeFocusView } from '../views/home-focus-view';

const IS_LIGHT = new URLSearchParams(location.search).get('theme') === 'light';
document.documentElement.dataset.themeLight = String(IS_LIGHT);
for (const [token, value] of Object.entries(
  (IS_LIGHT ? macroLightTheme : macroDarkTheme).colorTokens
)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}

function Fixture() {
  const scenario = new URLSearchParams(location.search).get('scenario');
  const [items, setItems] = createSignal<FeedItem[] | undefined>(
    scenario === 'loading' || scenario === 'error'
      ? undefined
      : TEST_ITEMS.map((item) => ({
          ...item,
          id: scenario === 'escaped-id' ? `${item.id}\"[]\\` : item.id,
        }))
  );
  const [loading, setLoading] = createSignal(scenario === 'loading');
  const [error, setError] = createSignal<string | undefined>(
    scenario === 'error' ? 'unavailable' : undefined
  );
  const source = {
    items,
    loading,
    error,
    refreshing: () => false,
    canRetry: () => true,
    refresh: async () => {
      setItems(TEST_ITEMS);
      setLoading(false);
      setError(undefined);
    },
  };
  const preferences = createFeedPreferences(
    'home-fixture',
    'Useful next steps'
  );
  const [opened, setOpened] = createSignal<string>();

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
        <Show
          when={opened()}
          fallback={
            <HomeFocusView
              active
              source={source}
              preferences={preferences}
              onOpen={(item) => setOpened(item.id)}
              onOpenFeed={() => setOpened('all')}
            >
              <h1 class="text-lg font-medium">Home priority list</h1>
              <Show when={loading()}>
                <Button
                  onClick={() => {
                    setItems(TEST_ITEMS);
                    setLoading(false);
                  }}
                >
                  Finish loading
                </Button>
              </Show>
            </HomeFocusView>
          }
        >
          <ForYouView
            source={source}
            preferences={preferences}
            focusedId={opened()}
            actions={{ start: async () => {}, openSource: () => {} }}
          />
        </Show>
      </div>
    </main>
  );
}
const ROOT = document.getElementById('root');
if (ROOT) render(() => <Fixture />, ROOT);
