import { batch, createEffect, createSignal, For, type Setter, untrack } from 'solid-js';
import { convertOklchTo, getOklch, validateColor } from '../utils/colorUtil';
import type { ThemeReactiveColor } from '../types/themeTypes';
import { themeReactive } from '../signals/themeReactive';
import { ColorPickerPopover } from './ColorPickerPopover';

const displayType = () => 'hex';

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
  catch(error) { console.error(`Error processing color "${colorString}":`, error); }
}

export function ThemeEditorAdvanced(){
  return (
    <>
      <style>{`
        .theme-editor-advanced-input::selection {
          background-color: var(--a0);
          color: var(--b0);
        }

        .theme-editor-advanced-input.invalid {
          color: var(--a0) !important;
        }
      `}</style>

      <div
        style={{
          'font-size': 'var(--text-xs)',
          'font-weight': 300,
          'display': 'block',
        }}
      >
        <div
          style="
            background-color: var(--b3);
            box-sizing: border-box;
            overflow-x: hidden;
            display: grid;
            gap: 1px;
          "
        >
          <For each={Object.entries(themeReactive)}>
              {([colorKey, colorValue]) => {
                // a1 thru a4 are not currently being used, so we will hide them
                if (['a1', 'a2', 'a3', 'a4'].includes(colorKey)) return null;
                const [isSetByInput, setIsSetByInput] = createSignal(false);
                const [inputValue, setInputValue] = createSignal('');

                createEffect(() => {
                  const newValue = convertOklchTo(
                    colorValue.l[0](),
                    colorValue.c[0](),
                    colorValue.h[0](),
                    displayType()
                  );
                  if (untrack(isSetByInput)) { setIsSetByInput(false); /* console.log('blocked!!!'); */ }
                  else { setInputValue(newValue); }
                });

                return (
                  <div
                    style="
                      font-family: var(--font-mono);
                      background-color: var(--b0);
                    "
                  >
                    <div
                      style="
                        grid-template-columns: 104px calc(7ch + 40px) 1fr calc(4ch + 40px);
                        background-color: var(--b3);
                        align-items: center;
                        display: grid;
                        height: 61px;
                        gap: 1px 0px;
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
                        <ColorPickerPopover colorKey={colorKey} colorValue={colorValue} />
                      </div>

                      <div
                        style="
                          background-color: var(--b0);
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
                          onInput={ (e) => {setColor(colorValue, e.target.value, e.target, setIsSetByInput); }}
                          style="
                            color: var(--color-ink-extra-muted);
                            font-family: var(--font-mono);
                            font-size: var(--text-xs);
                            background: transparent;
                            font-weight: 300;
                            outline: none;
                            border: none;
                            width: 100%;
                          "
                          class="theme-editor-advanced-input"
                          value={inputValue()}
                          type="text"
                        />
                      </div>

                      <div
                        style="
                          color: var(--color-ink-extra-muted);
                          background-color: var(--b0);
                          box-sizing: border-box;
                          align-items: center;
                          white-space: nowrap;
                          text-overflow: ellipsis;
                          padding: 0 20px;
                          overflow: hidden;
                          display: grid;
                          height: 100%;
                          width: 100%;
                        "
                      >
                        {colorValue.description}
                      </div>
                      <div
                        style="
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
                        --{colorKey}
                      </div>
                    </div>
                  </div>
                );
              }}
          </For>
        </div>
      </div>
    </>
  );
}
