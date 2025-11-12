import { For } from 'solid-js';
import { currentThemeId, isThemeSaved, themes } from '../signals/themeSignals';
import { applyTheme } from '../utils/themeUtils';
import { ColorSwatch } from './ColorSwatch';

export function ThemeList() {
  return (
    <>
      <style>{`
        .theme-list-wrapper {
          font-family: "Forma DJR Mono";
          border: 1px solid var(--b4);
          overscoll-behavior: none;
          scrollbar-width: none;
          overflow-y: scroll;
          font-size: 14px;
        }
        .theme-list-grid {
          background-color: var(--b4);
          overscroll-behavior: none;
          box-sizing: border-box;
          overflow-x: hidden;
          display: grid;
          gap: 1px;
        }
        .theme-item {
          grid-template-columns: min-content 1fr;
          background-color: var(--b0);
          align-items: center;
          padding: 10px 20px;
          display: grid;
          gap: 20px;
        }
        .theme-select{
            grid-template-columns: 1fr min-content;
            transition: color var(--transition);
            align-items: center;
            user-select: none;
            cursor: pointer;
            display: grid;
            gap: 20px;
        }
        .theme-select.current-theme{
          transition: none;
          color: var(--a0);

          hr{
            border-color: var(--a0);
            transition: none;
          }
        }
        .swatches{
          grid-template-columns: repeat(3, min-content);
          display: grid;
          gap: 5px;
        }
        .theme-item div {
          white-space: nowrap;
        }
        hr {
          borde: none;
          border-top: 1px dashed var(--b4);
          transition: border-color var(--transition);
          box-sizing: border-box;
          width: 100%;
        }
        .theme-list-list {
          border-top: 1px dashed var(--b4);
          padding: 10px;
        }
        @media(hover){
          .theme-select:hover{
            transition: none;
            color: var(--a0);

            hr{
              border-color: var(--a0);
              transition: none;
            }
          }
        }
      `}</style>

      <div class="theme-list-wrapper">
        <div class="theme-list-grid">
          <For each={themes()}>
            {(theme) => (
              <div class="theme-item">
                <div class="swatches">
                  {/*<For each={Object.entries(theme.tokens)}>
                    {([tokenName, tokenValue]) => (
                      <Swatch width={"10px"} color={`oklch(${tokenValue.l} ${tokenValue.c} ${tokenValue.h}deg)`}/>
                    )}
                  </For>*/}
                  <ColorSwatch
                    width={'10px'}
                    color={`oklch(${theme.tokens.a0.l} ${theme.tokens.a0.c} ${theme.tokens.a0.h}deg)`}
                  />
                  <ColorSwatch
                    width={'10px'}
                    color={`oklch(${theme.tokens.b0.l} ${theme.tokens.b0.c} ${theme.tokens.b0.h}deg)`}
                  />
                  <ColorSwatch
                    width={'10px'}
                    color={`oklch(${theme.tokens.c0.l} ${theme.tokens.c0.c} ${theme.tokens.c0.h}deg)`}
                  />
                </div>

                <div
                  class={`theme-select ${theme.id === currentThemeId() && isThemeSaved() ? 'current-theme' : ''}`}
                  onPointerDown={() => {
                    applyTheme(theme.id);
                  }}
                >
                  <hr />
                  <div>{theme.name}</div>
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
