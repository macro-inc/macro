import { themeReactive } from '../signals/themeReactive';
import { ColorSwatch } from './ColorSwatch';
import { For } from 'solid-js';

// function setInput(){
//   get content colorValue
//   check if value is a valid css color
//   if not valid, console.log(`${color} not valid`) and early return
//   convert color to oklch
//   console.log(converted color);
// }

export function ThemeEditorAdvanced() {
  return (
    <div class="advanced-theme-host">
      <style>{`
        .advanced-theme-host {
          font-family: "Forma DJR Mono";
          scrollbar-width: none;
          overflow: hidden;
          font-size: 14px;
          display: block;
          height: 100%;
        }
        .advanced-theme-host *::selection {
          background-color: var(--a0);
          color: var(--b0);
        }
        .advanced-theme-wrapper {
          border: 1px solid var(--b4);
          overscroll-behavior: none;
          box-sizing: border-box;
          scrollbar-width: none;
          overflow-y: scroll;
          height: 100%;
          width: 100%;
        }
        .advanced-theme-color-grid {
          background-color: var(--b4);
          box-sizing: border-box;
          overflow-x: hidden;
          display: grid;
          gap: 1px;
        }
        .advanced-theme-color-wrapper {
          background-color: var(--b0);
        }
        .advanced-theme-color {
          grid-template-columns: min-content min-content 1fr min-content;
          align-items: center;
          display: grid;
          padding: 10px 20px;
          gap: 20px;
        }
        .advanced-theme-color div {
          white-space: nowrap;
        }
        .advanced-theme-color hr {
          border: none;
          border-top: 1px dashed var(--b4);
          width: 100%;
        }
        .advanced-theme-list {
          border-top: 1px dashed var(--b4);
          padding: 10px;
        }
        .advanced-theme-color-editable {
          word-wrap: nowrap;
          width: min-content;
          min-width: 10px;
          outline: none;
        }
        .advanced-theme-color-editable.invalid {
          color: var(--a0);
        }
        .advanced-theme-color-editable.valid {
          color: var(--c0);
        }
        .input{
          border: none;
          outline: none;
          display: block;
        }
        .input-group {
          display: grid;
          grid-template-columns: repeat(5, min-content);
          width: min
          gap: 2px;
        }

        `}</style>

      <div class="advanced-theme-wrapper">
        <div class="advanced-theme-color-grid">
          <For each={Object.entries(themeReactive)}>
            {([colorKey, colorValue]) => (
              <div class="advanced-theme-color-wrapper">
                <div class="advanced-theme-color">
                  <ColorSwatch
                    width={'100px'}
                    color={`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`}
                  />

                  <div class="input-group">
                    <div>oklch(</div>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="1"
                      value={colorValue.l[0]().toFixed(2)}
                      onInput={(e) =>
                        colorValue.l[1](
                          Math.max(
                            Math.min(parseFloat(e.target.value), 1),
                            0
                          ) || 0
                        )
                      }
                      class="input number-input"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="0.37"
                      value={colorValue.c[0]().toFixed(2)}
                      onInput={(e) =>
                        colorValue.c[1](
                          Math.max(
                            Math.min(parseFloat(e.target.value), 0.37),
                            0
                          ) || 0
                        )
                      }
                      class="input number-input"
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max="360"
                      value={colorValue.h[0]().toFixed(1)}
                      onInput={(e) =>
                        colorValue.h[1](
                          Math.max(
                            Math.min(parseFloat(e.target.value), 360),
                            0
                          ) || 0
                        )
                      }
                      class="input number-input"
                    />
                    <div>deg)</div>
                  </div>

                  <hr />

                  <div>--{colorKey}</div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
