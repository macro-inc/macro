import { currentThemeId, isThemeSaved, showDarkThemes, showLightThemes, themes } from '../signals/themeSignals';
import { useAnalytics } from 'app/component/analytics-context';
import { applyTheme, isTokensDark } from '../utils/themeUtils';
import { ThemeChips } from './ThemeChips';
import { ThemeCrud } from './ThemeCrud';
import { cn } from '@ui';

import { createMemo, For } from 'solid-js';

function ThemeList() {
  const analytics = useAnalytics()

  const visibleThemes = createMemo(() =>
    themes().filter((theme) =>
      isTokensDark(theme.tokens) ? showDarkThemes() : showLightThemes()
    )
  );

  return (
      <div class="@container p-2">
        <div class="grid grid-cols-1 gap-2 @md:grid-cols-2 @2xl:grid-cols-3">
          <For each={visibleThemes()}>
            {(theme) => {
              const selected = () => theme.id === currentThemeId() && isThemeSaved();
              const select = () => {
                analytics.track('theme_changed', { themeId: theme.id })
                applyTheme(theme.id)
              };
              return (
                // role="button" (not <button>) because the card contains ThemeCrud's
                // own buttons, and nesting native buttons is invalid HTML.
                <div
                  role="button"
                  tabIndex={0}
                  class={cn(
                    'flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border bg-surface p-2 transition-colors duration-[var(--transition)]',
                    selected() ? 'border-accent' : 'border-edge-muted hover:border-ink-muted'
                  )}
                  onClick={select}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      select()
                    }
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
