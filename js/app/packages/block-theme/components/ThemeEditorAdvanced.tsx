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

// <style>{`
//   .advanced-theme-host *::selection {
//     background-color: var(--a0);
//     color: var(--b0);
//   }

//   .advanced-theme-color-editable.invalid {
//     color: var(--a0);
//   }
//   .advanced-theme-color-editable.valid {
//     color: var(--c0);
//   }
// `}</style>

export function ThemeEditorAdvanced() {
  return (
    <div style="
      font-family: 'Forma DJR Mono';
      scrollbar-width: none;
      position: relative;
      overflow: hidden;
      font-size: 14px;
      display: block;
      height: 100%;
    ">
      <div style="
        border: 1px solid var(--b4);
        overscroll-behavior: none;
        box-sizing: border-box;
        scrollbar-width: none;
        overflow-y: scroll;
        height: 100%;
        width: 100%;
      ">
        <div style="
          background-color: var(--b4);
          box-sizing: border-box;
          overflow-x: hidden;
          display: grid;
          gap: 1px;
        ">
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
              onChange={setDisplayType}
              value={displayType()}
              list={formatArray}
              label="format:"
              size="SM"
            />
          </div>
          <div style="height: 41px;"/>

          <For each={Object.entries(themeReactive)}>
            {([colorKey, colorValue]) => {

              const [isSetByInput, setIsSetByInput] = createSignal(false);

              // createEffect(() => {
              //   if (selected()) {
              //     console.log(`Item ${item.id} is selected`);
              //   }
              // });

              return (
                <div style="background-color: var(--b0);">
                  <div style="
                    grid-template-columns: min-content 1fr min-content;
                    background-color: var(--b4);
                    align-items: center;
                    display: grid;
                    height: 41px;
                    gap: 1px;
                  ">
                    <div style="
                      background-color: var(--b0);
                      box-sizing: border-box;
                      align-items: center;
                      padding: 0 20px;
                      display: grid;
                      height: 100%;
                      width: 100%;
                    ">
                      <ColorSwatch
                        color={`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`}
                        width={'100px'}
                      />
                    </div>

                    <div style="
                      background-color: var(--b0);
                      box-sizing: border-box;
                      align-items: center;
                      white-space: nowrap;
                      padding: 0 20px;
                      display: grid;
                      height: 100%;
                      width: 100%;
                    ">
                      <input
                        value={convertOklchTo(`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`, displayType())}
                        onInput={e => {setColor(colorValue, e.target.value)}}
                        type="text"
                        style="
                          outline: none;
                          border: none;
                          width: 100%;
                        "/>
                    </div>

                    <div style="
                      background-color: var(--b0);
                      box-sizing: border-box;
                      white-space: nowrap;
                      align-items: center;
                      padding: 0 20px;
                      display: grid;
                      height: 100%;
                      width: 100%;
                    ">
                      --{colorKey}
                    </div>
                  </div>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
