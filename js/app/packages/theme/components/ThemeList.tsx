import { currentThemeId, isThemeSaved, showDarkThemes, showLightThemes, themes } from '../signals/themeSignals';
import { useAnalytics } from 'app/component/analytics-context';
import { applyTheme } from '../utils/themeUtils';
import { ThemeChips } from './ThemeChips';
import { ThemeCrud } from './ThemeCrud';

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
      <>
        <style>{`
          .theme-list-item-name.current-theme{
            transition: none !important;
            color: var(--a0) !important;
          }

          @media(hover){
            .theme-list-item-name:hover{
              transition: none !important;
              color: var(--a0) !important;
            }
          }
        `}</style>

        <div
          style="
            grid-template-columns: min-content 1fr min-content;
            background-color: var(--b3);
            box-sizing: border-box;
            grid-auto-rows: 61px;
            overflow-x: hidden;
            font-size: 14px;
            display: grid;
            gap: 1px 0px;
          "
        >
          <For each={visibleThemes()}>
            {(theme) => (
              <>
                <div
                  style="
                    background-color: var(--b0);
                    box-sizing: border-box;
                    align-items: center;
                    padding: 0 20px;
                    display: flex;
                    height: 100%;
                    width: 100%;
                    gap: 5px;
                  "
                >
                  <ThemeChips theme={theme} />
                </div>
                <div
                  class={`theme-list-item-name ${theme.id === currentThemeId() && isThemeSaved() ? 'current-theme' : ''}`}
                  onClick={() => {
                    analytics.track('theme_changed', {themeId: theme.id})
                    applyTheme(theme.id)
                  }}
                  style="
                    transition: color var(--transition);
                    background-color: var(--b0);
                    box-sizing: border-box;
                    white-space: nowrap;
                    align-items: center;
                    padding: 0 20px;
                    cursor: pointer;
                    display: flex;
                    height: 100%;
                    width: 100%;
                  "
                >
                  {theme.name}
                </div>
                <ThemeCrud themeId={theme.id} />
              </>
            )}
          </For>
        </div>
      </>
  );
}

export default ThemeList;
