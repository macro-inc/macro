import type { ThemeReactiveColor } from '../types/themeTypes';
import { getOklch, validateColor } from '../utils/colorUtil';
import { themeReactive } from '../signals/themeReactive';
import { convertOklchTo } from '../utils/colorUtil';
import { createSignal, For } from 'solid-js';
import { ColorSwatch } from './ColorSwatch';

const [ displayType, setDisplayType ] = createSignal('hex');

function setColor(colorValue: ThemeReactiveColor, colorString: string){
  if(colorString && colorString.length < 6 && !validateColor(colorString)){
    console.log(`${colorValue} not valid color`);
    return;
  }
  let oklch = getOklch(colorString);
  colorValue.l[1](oklch.l);
  colorValue.c[1](oklch.c);
  colorValue.h[1](oklch.h);
}

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
                    color={`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`}
                    width={'100px'}
                  />
                  <input
                    value={convertOklchTo(`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`, displayType())}
                    onInput={e => {setColor(colorValue, e.target.value)}}
                    type="text"
                  />
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
