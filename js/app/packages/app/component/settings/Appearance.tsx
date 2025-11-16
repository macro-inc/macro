// import { ComputeTokens } from '../../../block-theme/ComputeTokens';

import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import { TabContent } from '@core/component/TabContent';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { createEffect, createSignal } from 'solid-js';
import { ThemeEditorAdvanced } from '../../../block-theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../block-theme/components/ThemeEditorBasic';
import ThemeList from '../../../block-theme/components/ThemeList';
import ThemeTools from '../../../block-theme/components/ThemeTools';
import {
  getCustomCursorEnabled,
  setCustomCursorEnabled,
} from '../../util/cursor';

export function Appearance() {
  const [cursorEnabled, setCursorEnabled] = createSignal(
    getCustomCursorEnabled()
  );

  createEffect(() => {
    setCustomCursorEnabled(cursorEnabled());
  });

  return (
    <TabContent title="Appearance">
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
        <div
          style={{
            'font-family': 'var(--font-mono)',
            border: '1px solid var(--b4)',
            'box-sizing': 'border-box',
            padding: '12px 20px',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            'font-size': '14px',
          }}
        >
          <span>Themed cursor</span>
          <ToggleSwitch
            checked={cursorEnabled()}
            onChange={(enabled) => setCursorEnabled(enabled)}
          />
        </div>
      </div>
    </TabContent>
  );
}
