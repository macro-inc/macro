

// import { customCursorEnabled, setCustomCursorEnabled } from '../custom-cursor/custom-cursor';
import { ThemeEditorAdvanced } from '../../../block-theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../block-theme/components/ThemeEditorBasic';
import { ENABLE_CUSTOM_CURSOR, ENABLE_SOUND } from '@core/constant/featureFlags';
// import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
// import { ComputeTokens } from '../../../block-theme/ComputeTokens';
import ThemeTools from '../../../block-theme/components/ThemeTools';
import ThemeList from '../../../block-theme/components/ThemeList';
import { createEffect, createSignal, Show } from 'solid-js';
import { isMobileWidth } from '@core/mobile/mobileWidth';

export function Appearance() {
  // const [cursorEnabled, setCursorEnabled] = createSignal(customCursorEnabled());

  return (
      <div
        style={{
          'grid-template-rows': `min-content min-content ${isMobileWidth() ? '205px' : '269px'}`,
          display: 'grid',
          gap: '8px',
        }}
      >
        <ThemeTools />

        <div
          style={{
            'grid-template-columns': '1fr',
            display: 'grid',
            gap: '8px',
          }}
        >
          {/*<ComputeTokens />*/}
          <ThemeEditorBasic />
        </div>

        <div
          style={{
            'grid-template-columns': `${isMobileWidth() ? '1fr' : '1fr 1fr'}`,
            display: 'grid',
            gap: '8px',
          }}
        >
          <ThemeEditorAdvanced />
          <ThemeList />
        </div>

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
