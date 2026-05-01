import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { useAnalytics } from 'app/component/analytics-context';
import { applyTheme } from '../utils/themeUtils';
import { ColorSwatch } from './ColorSwatch';

import { For } from 'solid-js';

export function ThemeList() {
  const analytics = useAnalytics()

  return (
    <>
      <style>{`
        .theme-list-item.current-theme{
          transition: none !important;
          color: var(--a0) !important;

          .theme-list-item-name{
            transition: none !important;
            color: var(--a0) !important;
          }

          .theme-color-swatch{
            border-color: var(--a0) !important;
            transition: none !important;
          }
        }

        @media(hover){
          .theme-list-item:hover{
            transition: none;
            color: var(--a0);

            .theme-list-item-name{
              transition: none !important;
              color: var(--a0) !important;
            }

            .theme-color-swatch{
              border-color: var(--a0) !important;
              transition: none !important;
            }
          }
        }
      `}</style>

      <div
        style="
          font-family: var(--font-sans);
          background-color: var(--b0);
          scrollbar-width: none;
          position: relative;
          overflow: hidden;
          font-size: 14px;
          display: block;
          height: 100%;
        "
      >
        <div
          style="
            overscroll-behavior: none;
            box-sizing: border-box;
            scrollbar-width: none;
            overflow-y: scroll;
            height: 100%;
            width: 100%;
          "
        >
          <div
            style="
              border-bottom: 1px solid var(--b3); /* temp remove when long */
              margin-bottom: -1px; /* temp remove when long */
              background-color: var(--b3);
              box-sizing: border-box;
              overflow-x: hidden;
              display: grid;
              gap: 1px;
            "
          >
            <div
              style="
                border-bottom: 1px solid var(--b3);
                background-color: var(--b0);
                align-items: center;
                position: absolute;
                padding: 0 20px;
                display: grid;
                height: 42px;
                width: 100%;
                z-index: 1;
              "
            >
              <div
                style={{
                  'font-size': '0.875rem',
                  'font-weight': '600'
                }}
              >
                Theme List
              </div>
            </div>
            <div style="height: 41px;" />
          <For each={themes()}>
            {(theme) => (
              <div
                class={`theme-list-item ${theme.id === currentThemeId() && isThemeSaved() ? 'current-theme' : ''}`}
                onClick={() => {
                  analytics.track('theme_changed', {themeId: theme.id})
                  applyTheme(theme.id)
                }}
                style="
                  cursor: var(--cursor-pointer);
                "
              >
                <div
                  style="

                    grid-template-columns: min-content 1fr;
                    background-color: var(--b3);
                    align-items: center;
                    display: grid;
                    height: 41px;
                    gap: 1px;
                  "
                >
                  <div
                    style="
                      background-color: var(--b0);
                      box-sizing: border-box;
                      align-items: center;
                      padding: 0 20px;
                      display: grid;
                      height: 100%;
                      width: 100%;
                    "
                  >
                    <div
                      style="
                        grid-template-columns: repeat(3, min-content);
                        display: grid;
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
                  </div>

                  <div
                    class="theme-list-item-name"
                    style="
                      transition: color var(--transition);
                      background-color: var(--b0);
                      box-sizing: border-box;
                      white-space: nowrap;
                      align-items: center;
                      padding: 0 20px;
                      display: grid;
                      height: 100%;
                      width: 100%;
                    "
                  >
                    {theme.name}
                  </div>
                </div>
              </div>
            )}
          </For>
          </div>
        </div>
      </div>
    </>
  );
}

export default ThemeList;
