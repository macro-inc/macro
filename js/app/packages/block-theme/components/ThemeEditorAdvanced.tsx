import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import type { ThemeReactiveColor } from '../types/themeTypes';
import { getOklch, validateColor } from '../utils/colorUtil';
import { themeReactive } from '../signals/themeReactive';
import { convertOklchTo } from '../utils/colorUtil';
import { createSignal, For } from 'solid-js';
import { ColorSwatch } from './ColorSwatch';

const formatArray = ['hex', 'rgb', 'hsl', 'oklch'];
const [ displayType, setDisplayType ] = createSignal(formatArray[0]);

function setColor(colorValue: ThemeReactiveColor, colorString: string) {
  if (!colorString || colorString.trim() === '' || colorString.length < 6 || !validateColor(colorString)) {return}
  try {
    let oklch = getOklch(colorString);
    colorValue.l[1](oklch.l ? Math.round(oklch.l * 100) / 100 : 0);
    colorValue.c[1](oklch.c ? Math.round(oklch.c * 100) / 100 : 0);
    colorValue.h[1](oklch.h ? Math.round(oklch.h * 100) / 100 : 0);
  }
  catch (error) {
    console.log(`Error processing color "${colorString}":`, error);
  }
}

export function ThemeEditorAdvanced() {
  return (
    <div class="advanced-theme-host">
      <style>{`
        .advanced-theme-host {
          font-family: "Forma DJR Mono";
          scrollbar-width: none;
          position: relative;
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
          grid-template-columns: min-content 1fr min-content;
          background-color: var(--b4);
          align-items: center;
          display: grid;
          height: 41px;
          gap: 1px;
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
          width: 100%;
        }

        dropdown-trigger {
          padding: 8px 12px;
          background-color: var(--b0);
          cursor: pointer;
        }

        .dropdown-content {
          background-color: var(--b0);
          border: 1px solid var(--b4);
          z-index: 1000;
        }

        .dropdown-item {
          padding: 8px 12px;
          cursor: pointer;
        }

        .dropdown-item:hover, .dropdown-item[data-highlighted] {
          background-color: var(--b4);
        }

      `}</style>

      <div class="advanced-theme-wrapper">
        <div class="advanced-theme-color-grid">

          <div style="
            border-bottom: 1px solid var(--b4);
            background-color: var(--b0);
            width: calc(100% - 2px);
            align-items: center;
            position: absolute;
            padding: 0 20px;
            display: grid;
            height: 42px;
            z-index: 1;
            left: 1px;
            top: 1px;
          ">
            <SegmentedControl
              size="SM"
              label="format:"
              list={formatArray}
              value={displayType()}
              onChange={setDisplayType}
            />

          </div>
          <div style="height: 41px;"/>

          <For each={Object.entries(themeReactive)}>
            {([colorKey, colorValue]) => (
              <div class="advanced-theme-color-wrapper">
                <div class="advanced-theme-color">

                  <div style="padding: 0 20px; box-sizing: border-box; display: grid; width: 100%; height: 100%; align-items: center; background-color: var(--b0);">
                    <ColorSwatch
                      color={`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`}
                      width={'100px'}
                    />
                  </div>

                  <div style="padding: 0 20px; box-sizing: border-box; display: grid; width: 100%; height: 100%; align-items: center; background-color: var(--b0);">
                    <input
                      value={convertOklchTo(`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`, displayType())}
                      onInput={e => {setColor(colorValue, e.target.value)}}
                      type="text"
                    />
                  </div>

                  <div style="padding: 0 20px; box-sizing: border-box; display: grid; width: 100%; height: 100%; align-items: center; background-color: var(--b0);">
                    --{colorKey}
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
