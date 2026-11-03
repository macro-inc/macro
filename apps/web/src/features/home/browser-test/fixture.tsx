import '@fontsource-variable/inter';
import '../../../index.css';
import HomeIcon from '@icon/system/regular/house.svg';
import SidebarIcon from '@icon/system/regular/sidebar-simple.svg';
import { Button } from '@ui';
import { render } from 'solid-js/web';
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
        <HomeFocusView active>
          <h1 class="text-lg font-medium">Home priority list</h1>
        </HomeFocusView>
      </div>
    </main>
  );
}
const ROOT = document.getElementById('root');
if (ROOT) render(() => <Fixture />, ROOT);
