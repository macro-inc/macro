import { For } from 'solid-js';
import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { applyTheme } from '../utils/themeUtils';
import { ColorSwatch } from './ColorSwatch';

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

            hr{
              border-color: var(--a0) !important;
              transition: none !important;
            }
          }
        }
      `}</style>

      <div
        style="
          font-family: var(--font-mono);
          border: 1px solid var(--b4);
          overscoll-behavior: none;
          scrollbar-width: none;
          overflow-y: scroll;
          font-size: 14px;
        "
      >
        <div
          style="
            background-color: var(--b4);
            overscroll-behavior: none;
            box-sizing: border-box;
            overflow-x: hidden;
            display: grid;
            gap: 1px;
          "
        >
          <For each={themes()}>
            {(theme) => (
              <div
                class={`theme-list-item ${theme.id === currentThemeId() && isThemeSaved() ? 'current-theme' : ''}`}
                onPointerDown={() => {applyTheme(theme.id)}}
                style="
                  grid-template-columns: min-content 1fr min-content;
                  background-color: var(--b0);
                  align-items: center;
                  padding: 10px 20px;
                  cursor: var(--cursor-pointer);
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

                <hr
                  style="
                    border: none;
                    transition: border-color var(--transition);
                    border-top: 1px dashed var(--b4);
                    box-sizing: border-box;
                    width: 100%;
                  "
                />

                <div
                  class="theme-list-item-name"
                  style="
                    transition: color var(--transition);
                    white-space: nowrap;
                  "
                >
                  {theme.name}
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </>
  );
}

export default ThemeList;
