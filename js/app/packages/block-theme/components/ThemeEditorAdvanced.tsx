import { batch, createEffect, createSignal, For, type Setter, untrack } from 'solid-js';
import { SegmentedControl } from '@core/component/FormControls/SegmentControls';
import { convertOklchTo, getOklch, validateColor } from '../utils/colorUtil';
import type { ThemeReactiveColor } from '../types/themeTypes';
import { themeReactive } from '../signals/themeReactive';
import { ColorSwatch } from './ColorSwatch';

const formatArray = ['hex', 'rgb', 'hsl', 'oklch'];
const [displayType, setDisplayType] = createSignal(formatArray[0]);

function setColor(colorValue: ThemeReactiveColor, colorString: string, inputElement: HTMLInputElement, setIsSetByInput: Setter<boolean>){
  if(!colorString || colorString.trim() === '' || colorString.length < 6 || !validateColor(colorString)){
    inputElement.classList.add('invalid');
    return;
  }
  try {
    let oklch = getOklch(colorString);
    batch(() => {
      setIsSetByInput(true);
      colorValue.l[1](oklch.l ? oklch.l : 0);
      colorValue.c[1](oklch.c ? oklch.c : 0);
      colorValue.h[1](oklch.h ? oklch.h : 0);
    });
    inputElement.classList.remove('invalid');
  }
  catch(error) {
    console.error(`Error processing color "${colorString}":`, error);
  }
}

export function ThemeEditorAdvanced(){
  return (
    <>
      <style>{`
        .theme-editor-advanced-input::selection {
          background-color: var(--a0);
          color: var(--b1);
        }

        .theme-editor-advanced-input.invalid {
          color: var(--a0) !important;
        }
      `}</style>

      <div
        style="
        font-family: var(--font-mono);
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
          border: 1px solid var(--b4);
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
            background-color: var(--b4);
            box-sizing: border-box;
            overflow-x: hidden;
            display: grid;
            gap: 1px;
          "
          >
            <div
              style="
              border-bottom: 1px solid var(--b4);
              background-color: var(--b1);
              width: calc(100% - 2px);
              align-items: center;
              position: absolute;
              padding: 0 20px;
              display: grid;
              height: 42px;
              z-index: 1;
              left: 1px;
              top: 1px;
            "
            >
              <SegmentedControl
                onChange={setDisplayType}
                value={displayType()}
                list={formatArray}
                label="format:"
                size="SM"
              />
            </div>
            <div style="height: 41px;" />

            <For each={Object.entries(themeReactive)}>
              {([colorKey, colorValue]) => {
                const [isSetByInput, setIsSetByInput] = createSignal(false);
                const [inputValue, setInputValue] = createSignal('');

                createEffect(() => {
                  const newValue = convertOklchTo(
                    colorValue.l[0](),
                    colorValue.c[0](),
                    colorValue.h[0](),
                    displayType()
                  );
                  if (untrack(isSetByInput)) {
                    setIsSetByInput(false);
                    // console.log('blocked!!!!!!!!!!!!');
                  } else {
                    setInputValue(newValue);
                  }
                });

                return (
                  <div style="background-color: var(--b1);">
                    <div
                      style="
                      grid-template-columns: min-content 1fr min-content;
                      background-color: var(--b4);
                      align-items: center;
                      display: grid;
                      height: 41px;
                      gap: 1px;
                    "
                    >
                      <div
                        style="
                        background-color: var(--b1);
                        box-sizing: border-box;
                        align-items: center;
                        padding: 0 20px;
                        display: grid;
                        height: 100%;
                        width: 100%;
                      "
                      >
                        <ColorSwatch
                          color={`oklch(${colorValue.l[0]()} ${colorValue.c[0]()} ${colorValue.h[0]()}deg)`}
                          width={'100px'}
                        />
                      </div>

                      <div
                        style="
                        background-color: var(--b1);
                        box-sizing: border-box;
                        align-items: center;
                        white-space: nowrap;
                        padding: 0 20px;
                        display: grid;
                        height: 100%;
                        width: 100%;
                      "
                      >
                        <input
                          onInput={(e) => {
                            setColor(
                              colorValue,
                              e.target.value,
                              e.target,
                              setIsSetByInput
                            );
                          }}
                          class="theme-editor-advanced-input"
                          value={inputValue()}
                          type="text"
                          style="
                            outline: none;
                            border: none;
                            width: 100%;
                          "
                        />
                      </div>

                      <div
                        style="
                        background-color: var(--b1);
                        box-sizing: border-box;
                        white-space: nowrap;
                        align-items: center;
                        padding: 0 20px;
                        display: grid;
                        height: 100%;
                        width: 100%;
                      "
                      >
                        --{colorKey}
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>
    </>
  );
}
