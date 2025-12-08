// import { customCursorEnabled, setCustomCursorEnabled } from '../custom-cursor/custom-cursor';
import { ThemeEditorAdvanced } from '../../../block-theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../block-theme/components/ThemeEditorBasic';
// import { ENABLE_CUSTOM_CURSOR, ENABLE_SOUND } from '@core/constant/featureFlags';
// import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
// import { ComputeTokens } from '../../../block-theme/ComputeTokens';
import ThemeTools from '../../../block-theme/components/ThemeTools';
import ThemeList from '../../../block-theme/components/ThemeList';

export function Appearance() {
  // const [cursorEnabled, setCursorEnabled] = createSignal(customCursorEnabled());

  return (
    <>
      <style>{`
        .appearance-container{
          grid-template-areas: "tools" "basic" "list" "advanced";
          grid-template-rows: min-content min-content 1fr 1fr;
          grid-template-columns: 1fr;
        }
        @container(min-width: 650px){
          .appearance-container{
            grid-template-areas: "tools tools" "basic basic" "list advanced";
            grid-template-rows: min-content min-content 1fr;
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
      <div
        style="
          background-color: var(--color-edge-muted);
          container-type: inline-size;
          position: absolute;
          overflow: hidden;
          display: grid;
          inset: 0;
          gap: 1px;
        "
        class="appearance-container"
      >
        <div style="grid-area: tools;"><ThemeTools /></div>
        <div style="grid-area: basic;"><ThemeEditorBasic /></div>
        <div style="grid-area: list; overflow: hidden;"><ThemeList/></div>
        <div style="grid-area: advanced; overflow: hidden;"><ThemeEditorAdvanced /></div>

        {/*<Show when={ENABLE_CUSTOM_CURSOR}>
          <div
            style={{
              'justify-content': 'space-between',
              'font-family': 'var(--font-mono)',
              border: '1px solid var(--b4)',
              'box-sizing': 'border-box',
              'align-items': 'center',
              padding: '12px 20px',
              'font-size': '14px',
              display: 'flex',
            }}
          >
            <span>Themed cursor</span>
            <ToggleSwitch
              checked={cursorEnabled()}
              onChange={(enabled) => setCursorEnabled(enabled)}
            />
          </div>
        </Show>*/}
      </div>
    </>
  );
}
