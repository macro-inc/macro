// import { ComputeTokens } from '../../../block-theme/ComputeTokens';

import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import { TabContent } from '@core/component/TabContent';
import { ENABLE_CUSTOM_CURSOR, ENABLE_SOUND } from '@core/constant/featureFlags';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { createEffect, createSignal, Show } from 'solid-js';
import { ThemeEditorAdvanced } from '../../../block-theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../block-theme/components/ThemeEditorBasic';
import ThemeList from '../../../block-theme/components/ThemeList';
import ThemeTools from '../../../block-theme/components/ThemeTools';
import {
  getSoundEffectsEnabled,
  getSoundEffectsVolume,
  setSoundEffectsEnabled,
  setSoundEffectsVolume,
} from '../../util/soundSettings';
import {
  customCursorEnabled,
  setCustomCursorEnabled,
} from '../custom-cursor/custom-cursor';

export function Appearance() {
  const [cursorEnabled, setCursorEnabled] = createSignal(customCursorEnabled());
  const [soundEnabled, setSoundEnabled] = createSignal(
    getSoundEffectsEnabled()
  );
  const [soundVolume, setSoundVolume] = createSignal(getSoundEffectsVolume());

  createEffect(() => {
    setCustomCursorEnabled(cursorEnabled());
  });

  createEffect(() => {
    setSoundEffectsEnabled(soundEnabled());
  });

  createEffect(() => {
    setSoundEffectsVolume(soundVolume());
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
        <Show when={ENABLE_CUSTOM_CURSOR}>
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
        </Show>
        <div
          style={{
            'font-family': 'var(--font-mono)',
            border: '1px solid var(--b4)',
            'box-sizing': 'border-box',
            padding: '12px 20px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '12px',
            'font-size': '14px',
          }}
        >

          <Show when={ENABLE_SOUND}>
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
              }}
            >
              <span>Sound effects</span>
              <ToggleSwitch
                checked={soundEnabled()}
                onChange={(enabled) => setSoundEnabled(enabled)}
              />
            </div>
            <div
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '12px',
              }}
            >
              <span style={{ 'min-width': '60px' }}>Volume</span>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  height: '18px',
                  display: 'flex',
                  'align-items': 'center',
                }}
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={soundVolume()}
                  onInput={(e) => {
                    const value = parseFloat(
                      (e.target as HTMLInputElement).value
                    );
                    setSoundVolume(value);
                  }}
                  style={{
                    '-webkit-appearance': 'none',
                    width: '100%',
                    'box-sizing': 'border-box',
                    'border-radius': '0px',
                    position: 'absolute',
                    background: 'transparent',
                    appearance: 'none',
                    cursor: 'var(--cursor-pointer)',
                    outline: 'none',
                    height: '100%',
                    margin: 0,
                    padding: 0,
                  }}
                  class="sound-volume-slider"
                />
              </div>
              <span style={{ 'min-width': '40px', 'text-align': 'right' }}>
                {Math.round(soundVolume() * 100)}%
              </span>
            </div>
          </Show>
          <style>{`
            .sound-volume-slider::-webkit-slider-thumb {
              -webkit-appearance: none;
              appearance: none;
              width: 18px;
              height: 18px;
              background-color: var(--b0);
              border: 1px solid var(--b4);
              border-radius: 0px;
              cursor: var(--cursor-pointer);
            }
            .sound-volume-slider::-moz-range-thumb {
              width: 18px;
              height: 18px;
              background-color: var(--b0);
              border: 1px solid var(--b4);
              border-radius: 0px;
              cursor: var(--cursor-pointer);
            }
            .sound-volume-slider::-webkit-slider-runnable-track {
              width: 100%;
              height: 1px;
              background: var(--b4);
            }
            .sound-volume-slider::-moz-range-track {
              width: 100%;
              height: 1px;
              background: var(--b4);
            }
          `}</style>
        </div>
      </div>
    </TabContent>
  );
}
