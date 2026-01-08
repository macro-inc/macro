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
      <div
        class="absolute inset-0 overflow-hidden bg-edge-muted @container gap-px grid grid-cols-1 grid-rows-[min-content_min-content_1fr_1fr] @[650px]:grid-cols-2 @[650px]:grid-rows-[min-content_min-content_1fr] touch:mobile-width:flex"
      >
        <div class="touch:mobile-width:hidden @[650px]:col-span-2"><ThemeTools /></div>
        <div class="touch:mobile-width:hidden @[650px]:col-span-2"><ThemeEditorBasic /></div>
        <div class="touch:mobile-width:flex-1 overflow-hidden"><ThemeList/></div>
        <div class="touch:mobile-width:hidden overflow-hidden"><ThemeEditorAdvanced /></div>

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
  );
}
