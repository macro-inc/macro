import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { useAnalytics } from 'app/component/analytics-context';
import { applyTheme } from '../utils/themeUtils';
import { ColorSwatch } from './ColorSwatch';
import { ThemeCrud } from './ThemeCrud';
import { Panel } from '@ui';

import { For } from 'solid-js';

export function ThemeList() {
  const analytics = useAnalytics()

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

        <Panel.Header class="px-5">
          <div class="text-sm font-semibold">Theme List</div>
        </Panel.Header>

        <Panel.Body scroll>
          <div
            style="
              grid-template-columns: min-content 1fr min-content;
              background-color: var(--b3);
              box-sizing: border-box;
              grid-auto-rows: 40px;
              overflow-x: hidden;
              font-size: 14px;
              display: grid;
              gap: 1px;
            "
          >
            <For each={themes()}>
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
                    <ColorSwatch
                      color={`oklch(${theme.tokens.a0.l} ${theme.tokens.a0.c} ${theme.tokens.a0.h}deg)`}
                      width={'10px'}
                    />
                    <ColorSwatch
                      color={`oklch(${theme.tokens.b0.l} ${theme.tokens.b0.c} ${theme.tokens.b0.h}deg)`}
                      width={'10px'}
                    />
                    <ColorSwatch
                      color={`oklch(${theme.tokens.c0.l} ${theme.tokens.c0.c} ${theme.tokens.c0.h}deg)`}
                      width={'10px'}
                    />
                  </div>

                  <div
                    class={`theme-list-item-name ${theme.id === currentThemeId() && isThemeSaved() ? 'current-theme' : ''}`}
                    onClick={() => {
                      analytics.track('theme_changed', {themeId: theme.id})
                      applyTheme(theme.id)
                    }}
                    style="
                      transition: color var(--transition);
                      cursor: var(--cursor-pointer);
                      background-color: var(--b0);
                      box-sizing: border-box;
                      white-space: nowrap;
                      align-items: center;
                      padding: 0 20px;
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
        </Panel.Body>
      </>
  );
}

export default ThemeList;
