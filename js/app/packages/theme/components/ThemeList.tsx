import { currentThemeId, isThemeSaved, showDarkThemes, showLightThemes, themes } from '../signals/themeSignals';
import { useAnalytics } from 'app/component/analytics-context';
import { applyTheme } from '../utils/themeUtils';
import { ThemeChips } from './ThemeChips';
import { ThemeCrud } from './ThemeCrud';
import { cn } from '@ui';

import { createMemo, For } from 'solid-js';

function ThemeList() {
  const analytics = useAnalytics()

  // A theme is intrinsically dark when its text is lighter than its background.
  const visibleThemes = createMemo(() =>
    themes().filter((theme) =>
      theme.tokens.c0.l > theme.tokens.b0.l ? showDarkThemes() : showLightThemes()
    )
  );

  return (
      <div class="@container p-2">
        <div class="grid grid-cols-1 gap-2 @md:grid-cols-2 @2xl:grid-cols-3">
          <For each={visibleThemes()}>
            {(theme) => {
              const selected = () => theme.id === currentThemeId() && isThemeSaved();
              return (
                <div
                  class={cn(
                    'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border bg-surface p-2 transition-colors',
                    selected() ? 'border-accent' : 'border-edge-muted hover:border-ink-muted'
                  )}
                  onClick={() => {
                    analytics.track('theme_changed', { themeId: theme.id })
                    applyTheme(theme.id)
                  }}
                >
                  <ThemeChips theme={theme} />
                  <span
                    class={cn(
                      'min-w-0 flex-1 truncate text-sm',
                      selected() ? 'text-accent' : 'text-ink'
                    )}
                  >
                    {theme.name}
                  </span>
                  <ThemeCrud themeId={theme.id} />
                </div>
              )
            }}
          </For>
        </div>
      </div>
  );
}

export default ThemeList;
