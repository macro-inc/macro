// import { ComputeTokens } from '../../../block-theme/ComputeTokens';
import { getSoundEffectsEnabled, getSoundEffectsVolume, setSoundEffectsEnabled, setSoundEffectsVolume} from '../../util/soundSettings';
import { setCustomCursorEnabled, customCursorEnabled } from '../custom-cursor/custom-cursor';
import { ThemeEditorAdvanced } from '../../../block-theme/components/ThemeEditorAdvanced';
import { ThemeEditorBasic } from '../../../block-theme/components/ThemeEditorBasic';
import { ToggleSwitch } from '@core/component/FormControls/ToggleSwitch';
import ThemeTools from '../../../block-theme/components/ThemeTools';
import ThemeList from '../../../block-theme/components/ThemeList';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { TabContent } from '@core/component/TabContent';
import { createEffect, createSignal } from 'solid-js';

export function Appearance() {
  const [cursorEnabled, setCursorEnabled] = createSignal(customCursorEnabled());
  const [soundEnabled, setSoundEnabled] = createSignal(getSoundEffectsEnabled());
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
          'display': 'grid',
          'gap': '8px',
        }}
      >
        <ThemeTools />

        <div
          style={{
            'grid-template-columns': '1fr',
            'display': 'grid',
            'gap': '8px',
          }}
        >
          {/*<ComputeTokens />*/}
          <ThemeEditorBasic />
        </div>

        <div
          style={{
            'grid-template-columns': `${isMobileWidth() ? '1fr' : '1fr 1fr'}`,
            'display': 'grid',
            'gap': '8px',
          }}
        >
          <ThemeEditorAdvanced />
          <ThemeList />
        </div>
        <div
          style={{
            'justify-content': 'space-between',
            'font-family': 'var(--font-mono)',
            'border': '1px solid var(--b4)',
            'box-sizing': 'border-box',
            'align-items': 'center',
            'padding': '12px 20px',
            'font-size': '14px',
            'display': 'flex',
          }}
        >
          <span>Themed cursor</span>
          <ToggleSwitch
            checked={cursorEnabled()}
            onChange={(enabled) => setCursorEnabled(enabled)}
          />
        </div>
        <div
          style={{
            'font-family': 'var(--font-mono)',
            'border': '1px solid var(--b4)',
            'box-sizing': 'border-box',
            'flex-direction': 'column',
            'padding': '12px 20px',
            'font-size': '14px',
            'display': 'flex',
            'gap': '12px',

          }}
        >
          <div
            style={{
              'justify-content': 'space-between',
              'align-items': 'center',
              'display': 'flex',
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
              'align-items': 'center',
              'display': 'flex',
              'gap': '12px',
            }}
          >
            <span style={{ 'min-width': '60px' }}>Volume</span>
            <div
              style={{
                'align-items': 'center',
                'position': 'relative',
                'display': 'flex',
                'height': '18px',
                'flex': '1',
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
                  'background': 'transparent',
                  'box-sizing': 'border-box',
                  'border-radius': '0px',
                  'position': 'absolute',
                  'appearance': 'none',
                  'cursor': 'pointer',
                  'outline': 'none',
                  'height': '100%',
                  'width': '100%',
                  'padding': '0',
                  'margin': '0',
                }}
                class="sound-volume-slider"
              />
            </div>
            <span style={{ 'min-width': '40px', 'text-align': 'right' }}>
              {Math.round(soundVolume() * 100)}%
            </span>
          </div>
          <style>{`
            .sound-volume-slider::-webkit-slider-thumb{
              background-color: var(--b0);
              border: 1px solid var(--b4);
              -webkit-appearance: none;
              border-radius: 0px;
              appearance: none;
              cursor: pointer;
              height: 18px;
              width: 18px;
            }
            .sound-volume-slider::-moz-range-thumb{
              background-color: var(--b0);
              border: 1px solid var(--b4);
              border-radius: 0px;
              cursor: pointer;
              height: 18px;
              width: 18px;
            }
            .sound-volume-slider::-webkit-slider-runnable-track{
              background: var(--b4);
              height: 1px;
              width: 100%;
            }
            .sound-volume-slider::-moz-range-track {
              background: var(--b4);
              height: 1px;
              width: 100%;
            }
          `}</style>
        </div>
      </div>
    </TabContent>
  );
}
