import { ENABLE_DOCK_NOTITIFCATIONS } from '@core/constant/featureFlags';
import { GlobalNotificationBell } from '@core/component/GlobalNotificationBell';
import { Show } from 'solid-js';
import { isRightPanelOpen, useToggleRightPanel } from '@core/signal/layout';
import { useSettingsState } from '@core/constant/SettingsState';
import { useGlobalNotificationSource } from '../GlobalAppState';
import MacroCreateIcon from '@macro-icons/macro-create-b.svg';
import { globalSplitManager } from '@app/signal/splitLayout';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { withAnalytics } from '@coparse/analytics';
import SplitIcon from '@macro-icons/new-split.svg';
import IconAI from '@macro-icons/wide/star.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import IconLogo from '@macro-icons/macro-logo.svg';
import { BasicTierLimit } from './BasicTierLimit';
import { setKonsoleOpen } from '../command/state';
import { Hotkey } from '@core/component/Hotkey';
import { setCreateMenuOpen } from '../Launcher';
import { useHasPaidAccess } from '@core/auth';
import { TOKENS } from '@core/hotkey/tokens';
import { QuickAccess } from './QuickAccess';
import { Button } from '@ui/components/Button';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { isMobile } from '@core/mobile/isMobile';

export function Dock() {
  const notificationSource = useGlobalNotificationSource();
  const isRightPanelCollapsed = () => !isRightPanelOpen();
  // const [debugOpen, setDebugOpen] = createSignal(false);
  const { track, TrackingEvents } = withAnalytics();
  const toggleRightPanel = useToggleRightPanel();
  const { settingsOpen, toggleSettings } = useSettingsState();
  const hasPaid = useHasPaidAccess();

  return (
    <>
      <style>{`
        .dock-button-hover{
          transition: var(--transition);
          background-color: #0000;
        }
        @media(hover){
          .dock-button-hover:hover{
            background-color: var(--color-hover);
            transition: none;
          }
        }
      `}</style>

      <div
        style={{
          'padding': '0 var(--gutter-size) var(--gutter-size) var(--gutter-size)',
          'height': 'calc(40px + var(--gutter-size))',
          'box-sizing': 'border-box',
          'width': '100vw'
        }}
      >
        <ClippedPanel bl br>
          <div style={{
            'grid-template-columns': 'min-content 1fr min-content',
            'box-sizing': 'border-box',
            'scrollbar-width': 'none',
            'align-content': 'center',
            'overflow-y': 'hidden',
            'padding': '0 7px',
            'display': 'grid',
            'height': '100%',
            'gap': '7px',
          }}>

            <div
              style={{
                'border-right': '1px solid var(--color-edge-muted)',
                'grid-auto-columns': 'min-content',
                'grid-auto-flow': 'column',
                'align-items': 'center',
                'padding-right': '7px',
                'display': 'grid',
                'gap': '7px'
              }}
            >
              <div
                style={{
                  'grid-template-columns': 'min-content min-content',
                  'box-sizing': 'border-box',
                  'align-items': 'center',
                  'padding': '0 4px',
                  'display': 'grid',
                  'height': '24px',
                  'gap': '7px'
                }}
                onClick={() => { setKonsoleOpen(true) }}
                class="dock-button-hover"
                data-hotkey-token={TOKENS.global.commandMenu}
              >
                <IconLogo
                  style={{
                    'display': 'block',
                    'height': '9px'
                  }}
                />
                {/*<div style={{
                  'font-family': 'monospace',
                  'background-color': '#f00',
                  'font-size': '10px',
                  'padding': '0 4px',
                }}>
                  <Hotkey token={TOKENS.global.createCommand}/>
                </div>*/}
                <div class="**:border-none! flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25">
                  <Hotkey shortcut="cmd+k" class="flex gap-1" />
                </div>
              </div>

              <div style={{
                'background-color': 'var(--color-edge-muted)',
                'height': '38px',
                'width': '1px',
              }} />

              <div
                style={{
                  'grid-template-columns': 'min-content min-content',
                  'box-sizing': 'border-box',
                  'align-items': 'center',
                  'padding': '0 4px',
                  'display': 'grid',
                  'height': '24px',
                  'gap': '10px'
                }}
                onClick={() => { setCreateMenuOpen(true) }}
                class="dock-button-hover"
                data-hotkey-token={TOKENS.global.createCommand}
              >
                <MacroCreateIcon
                  style={{
                    'display': 'block',
                    'height': '9px'
                  }}
                />
                {/*<div style={{
                  'background-color': '#f00',
                  'font-family': 'monospace',
                  'font-size': '10px',
                  'padding': '0 4px',
                }}>
                  <Hotkey token={TOKENS.global.commandMenu}/>
                </div>*/}
                <div class="**:border-none! flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25">
                  <Hotkey shortcut="c" />
                </div>
              </div>
            </div>

            <Show
              when={!isMobile()}
              fallback={<div></div>}
            >
              <div style={{
                'border-top': '1px solid var(--edge-muted)',
                'color': 'var(--ink-extra-muted)',
                'justify-content': 'center',
                'font-family': 'monospace',
                'align-items': 'center',
                'font-size': '0.75rem',
                'line-height': '1rem',
                'display': 'flex',
                'gap': '4px',
              }}>
                <Show when={!hasPaid()}>
                  <BasicTierLimit />
                </Show>

                <div class="w-full"/>

                <Show when={ENABLE_DOCK_NOTITIFCATIONS}>
                  <QuickAccess />
                  <GlobalNotificationBell notificationSource={notificationSource} />
                </Show>
              </div>
            </Show>

            <div style={{
              'border-left': '1px solid var(--color-edge-muted)',
              'grid-auto-columns': 'min-content',
              'grid-auto-flow': 'column',
              'align-items': 'center',
              'padding-left': '7px',
              'display': 'grid',
              'height': '38px',
              'gap': '4px'
            }}>
              <Button
                onClick={() => {
                  if (isRightPanelCollapsed()) { track(TrackingEvents.RIGHTBAR.OPEN) }
                  else { track(TrackingEvents.RIGHTBAR.CLOSE) }
                  toggleRightPanel();
                }}
                class="p-1 size-6"
                classList={{
                  "bg-accent/20 text-accent": !isRightPanelCollapsed(),
                }}
                tooltip={
                  <LabelAndHotKey label='Toggle AI Panel' hotkeyToken={TOKENS.split.go.toggleRightPanel} />
                }
              >
                <IconAI />
              </Button>

              <div class="mobile-width:hidden">
                <Button
                  tooltip={<LabelAndHotKey label='Create New Split' hotkeyToken={TOKENS.global.createNewSplit} />}
                  onClick={() => {
                    const manager = globalSplitManager();
                    if (manager) {
                      const canFit = manager.resizeContext()?.canFit({ minSize: 400 }) ?? true;
                      if (canFit) {
                        manager.createNewSplit({
                          content: {
                            id: 'unified-list',
                            type: 'component',
                          },
                          referredFrom: 'dock'
                        });
                    }
                  }
                }}
                class="p-1"
              >
                <SplitIcon class="h-4"/>
              </Button>
              </div>

              <Button
                tooltip={<LabelAndHotKey label={settingsOpen() ? 'Close Settings' : 'Open Settings'} hotkeyToken={TOKENS.global.toggleSettings} />}
                onClick={() => { toggleSettings() }}
                class="p-1 size-6"
                classList={{
                  "bg-accent/20 text-accent": settingsOpen(),
                }}
              >
                <IconGear />
              </Button>
            </div>
          </div>
        </ClippedPanel>
      </div>

      {/*<Show when={DEV_MODE_ENV}>
        <Debug/>
      </Show>*/}
    </>
  );
}
