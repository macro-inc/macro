import { For } from 'solid-js';
import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { applyTheme } from '../utils/themeUtils';
import { ThemeColorSwatch } from './ThemeColorSwatch';

export function ThemeList() {
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

          hr{
            border-color: var(--a0) !important;
            transition: none !important;
          }
        }

        @media(hover){
          .theme-list-item:hover{
            transition: none !important;
            color: var(--a0);

            .theme-list-item-name{
              transition: none !important;
              color: var(--a0) !important;
            }

            .theme-color-swatch{
              border-color: var(--a0) !important;
              transition: none !important;
            }

            hr{
              border-color: var(--a0) !important;
              transition: none !important;
            }
          }
        }
      `}</style>

      <div
        style="
          scrollbar-width: none;
          position: relative;
          display: block;
        "
      >
        <div
          style="
            overscroll-behavior: none;
            box-sizing: border-box;
            scrollbar-width: none;
            width: 100%;
          "
        >
          <div
            style="
              box-sizing: border-box;
              overflow-x: hidden;
              display: grid;
            "
          >
            <For each={themes()}>
              {(theme) => (
                <div
                  class={`theme-list-item ${theme.id === currentThemeId() && isThemeSaved() ? 'current-theme' : ''}`}
                  onPointerDown={() => {
                    applyTheme(theme.id);
                  }}
                  style="
                    grid-template-columns: min-content 1fr min-content;
                    align-items: center;
                    height: 22px;
                    display: grid;
                    gap: 20px;
                  "
                >
                  <div
                    style="
                      grid-template-columns: repeat(3, min-content);
                      display: grid;
                      gap: 5px;
                    "
                  >
                    <ThemeColorSwatch
                      color={`oklch(${theme.tokens.a0.l} ${theme.tokens.a0.c} ${theme.tokens.a0.h}deg)`}
                      width={'10px'}
                    />
                    <ThemeColorSwatch
                      color={`oklch(${theme.tokens.b0.l} ${theme.tokens.b0.c} ${theme.tokens.b0.h}deg)`}
                      width={'10px'}
                    />
                    <ThemeColorSwatch
                      color={`oklch(${theme.tokens.c0.l} ${theme.tokens.c0.c} ${theme.tokens.c0.h}deg)`}
                      width={'10px'}
                    />
                  </div>

                  <hr
                    style="
                      border: none;
                      border-top: 1px dashed var(--b4);
                      transition: border-color var(--transition);
                      box-sizing: border-box;
                      width: 100%;
                    "
                  />

                  <div
                    style="
                      transition: color var(--transition);
                      white-space: nowrap;
                    "
                    class="theme-list-item-name"
                  >
                    {theme.name}
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
