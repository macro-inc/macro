import { DEV_MODE_ENV, ENABLE_DOCK_NOTITIFCATIONS } from '@core/constant/featureFlags';
import { setSettingsOpen, useSettingsState } from '@core/constant/SettingsState';
import { GlobalNotificationBell } from '@core/component/GlobalNotificationBell';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { isRightPanelOpen, useToggleRightPanel } from '@core/signal/layout';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import SplitIcon from '@icon/regular/square-split-horizontal.svg';
import { useGlobalNotificationSource } from '../GlobalAppState';
import IconPower from '@phosphor-icons/core/regular/power.svg';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { PresentModeGlitch } from './PresentModeGlitch';
import { IconButton } from '@core/component/IconButton';
import IconQuestion from '@icon/regular/question.svg';
import { BasicHotkey } from '@core/component/Hotkey';
import { withAnalytics } from '@coparse/analytics';
import IconAtom from '@macro-icons/macro-atom.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import { BasicTierLimit } from './BasicTierLimit';
import { setKonsoleOpen } from '../command/state';
import { runCommand } from '@core/hotkey/hotkeys';
import { useHasPaidAccess } from '@core/auth';
import { TOKENS } from '@core/hotkey/tokens';
import { playSound } from '@app/util/sound';
import { QuickAccess } from './QuickAccess';
import { CreateMenu } from './CreateMenu';
import Hints from './Hints';

const { track, TrackingEvents } = withAnalytics();

export function Dock() {
  const hasPaid = useHasPaidAccess();
  const { settingsOpen } = useSettingsState();
  const toggleRightPanel = useToggleRightPanel();
  const isRightPanelCollapsed = () => !isRightPanelOpen();
  const activeSplitId = createMemo(() => globalSplitManager()?.activeSplitId());

  const notificationSource = useGlobalNotificationSource();

  const isSoupActive = createMemo(() => {
    const splitId = globalSplitManager()?.activeSplitId();
    if (!splitId) return false;
    const split = globalSplitManager()?.getSplit(splitId);
    if (!split) return false;
    return split.content().id === 'unified-list';
  });

  // This method of opening the correct help drawer is disgusting,
  // but it works and doesn't require changing anything else.
  const activeSoupDrawerCommand = () => {
    const currentActiveScope = activeScope();
    if (!currentActiveScope) return undefined;
    let activeScopeNode = hotkeyScopeTree.get(currentActiveScope);
    if (!activeScopeNode) return undefined;
    if (activeScopeNode?.type !== 'dom') return;
    const dom = activeScopeNode.element;
    const closestSplitScope = dom.closest('[data-hotkey-scope^="split"]');
    if (!closestSplitScope || !(closestSplitScope instanceof HTMLElement))
      return;
    const scopeId = closestSplitScope.dataset.hotkeyScope;
    if (!scopeId) return undefined;
    const splitNode = hotkeyScopeTree.get(scopeId);
    if (!splitNode) return undefined;
    return splitNode.hotkeyCommands.get('shift+/');
  };

  const [debugOpen, setDebugOpen] = createSignal(false);
  const [isPresentMode, setIsPresentMode] = createSignal(false);
  const [showGlitchEffect, setShowGlitchEffect] = createSignal(false);

  const enterPresentMode = async () => {
    try{
      playSound('Stab_Destruct');
      const element = document.documentElement;
      if(element.requestFullscreen){await element.requestFullscreen()}
      else if((element as any).webkitRequestFullscreen){await (element as any).webkitRequestFullscreen()}// Safari
      else if((element as any).mozRequestFullScreen)   {await (element as any).mozRequestFullScreen()}// Firefox
      else if((element as any).msRequestFullscreen)    {await (element as any).msRequestFullscreen()}// IE/Edge
      focusActiveSplit();
    }
    catch(error){
      console.error('Error entering present mode:', error);
    }
  };

  const exitPresentMode = async () => {
    try{
      if(document.exitFullscreen){await document.exitFullscreen()}
      else if((document as any).webkitExitFullscreen){await (document as any).webkitExitFullscreen()}// Safari
      else if((document as any).mozCancelFullScreen) {await (document as any).mozCancelFullScreen()}// Firefox
      else if((document as any).msExitFullscreen)    {await (document as any).msExitFullscreen()}// IE/Edge
      focusActiveSplit();
    }
    catch(error){
      console.error('Error exiting present mode:', error);
    }
  };

  const focusActiveSplit = () => {
    const id = activeSplitId();
    if (!id) return null;
    const splitEl = document.querySelector(`[data-split-id="${id}"]`) as HTMLElement;
    splitEl?.focus();
  };

  const togglePresentMode = () => {
    if(isPresentMode()){
      exitPresentMode();
      setShowGlitchEffect(false);
    }
    else{
      setShowGlitchEffect(true); // Show glitch effect before entering fullscreen
      setTimeout(() => {enterPresentMode()}, 200); // Enter fullscreen after a brief delay to let glitch start
    }
  };

  // Check if we're in fullscreen
  const checkFullscreen = () => {
    const isFullscreen =
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement;
    setIsPresentMode(!!isFullscreen);
  };

  // Listen for fullscreen changes
  onMount(() => {
    const events = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];

    events.forEach((event) => {document.addEventListener(event, checkFullscreen)});
    const handleKeyDown = (e: KeyboardEvent) => {if(e.key === 'Escape' && isPresentMode()){exitPresentMode()}};
    document.addEventListener('keydown', handleKeyDown);

    onCleanup(() => {
      events.forEach((event) => {document.removeEventListener(event, checkFullscreen)});
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  return(
    <>
      <div style={{
        'padding': '0 0.5rem 0.5rem 0.5rem'
      }}>
        <Show when={!isMobileWidth()}>
          <div style={{
            'grid-template-columns': 'min-content min-content 1fr min-content',
            'border': '1px solid var(--color-edge-muted)',
            'background-color': 'var(--color-panel)',
            'grid-template-rows': 'min-content',
            'box-sizing': 'border-box',
            'align-content': 'center',
            'position': 'relative',
            'padding': '0 4px',
            'display': 'grid',
            'height': '40px',
            'z-index': '1',
            'gap': '8px',
          }}>
            <div
              onMouseDown={() => setKonsoleOpen(true)}
              style={{
                'border-top': '1px solid var(--edge-muted)',
                'justify-content': 'space-between',
                'align-items': 'center',
                'position': 'relative',
                'display': 'flex',
                'gap': '0.5rem',
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                style={{
                  'color': 'var(--ink-muted)',
                  'transition': 'all 300ms',
                  'margin-bottom': '1px',
                  'height': '1.5rem',
                  'width': '1.5rem',
                }}
                viewBox="0 0 185.062 122.8"
              >
                <path
                  d="M48.143,0l-17.298,6.784v44.891l10.281,9.711v9.738l-10.281-9.72v-9.729l-13.547-12.792L0,45.664v51.515c0,.98.2,1.95.587,2.85.388.9.955,1.712,1.667,2.386l21.558,20.385,17.313-6.781v-44.891l54.654,51.673,17.313-6.781v-44.891l54.672,51.673,17.298-6.781v-51.515c0-.98-.2-1.95-.587-2.85-.388-.9-.955-1.712-1.667-2.385L120.127,0l-17.316,6.784v44.891l10.281,9.717-.1,9.638-10.181-9.623v-9.732L48.143,0Z"
                  fill="currentColor"
                />
              </svg>
              <div style={{
                'display': 'flex',
                'height': '100%',
                'width': '100%'
              }}>
                <BasicHotkey shortcut="cmd+k" />
              </div>
            </div>

            <CreateMenu />

            <Show when={!hasPaid()}>
              <BasicTierLimit />
            </Show>

            <div style={{
              'border-top': '1px solid var(--edge-muted)',
              'color': 'var(--ink-extra-muted)',
              'justify-content': 'center',
              'font-family': 'monospace',
              'align-items': 'center',
              'font-size': '0.75rem',
              'line-height': '1rem',
              'padding': '0 1.5rem',
              'display': 'flex',
              'gap': '1.5rem',
              'flex': '1',
            }}>

              <Show when={hasPaid()}>
                <Hints />
              </Show>

              <Show when={ENABLE_DOCK_NOTITIFCATIONS}>
                <QuickAccess />
                <GlobalNotificationBell notificationSource={notificationSource} />
              </Show>
            </div>

            <div style={{
              'border-right': '1px solid var(--edge-muted)',
              'border-top': '1px solid var(--edge-muted)',
              'align-items': 'stretch',
              'display': 'flex',
            }}>
              <IconButton
                style={{
                  'pointer-events': isSoupActive() ? 'auto' : 'none',
                  'opacity': isSoupActive() ? 1 : 0,
                  'aspect-ratio': '1',
                  'height': '100%',
                }}
                tooltip={{
                  hotkeyToken: TOKENS.split.showHelpDrawer,
                  label: 'Help',
                }}
                onClick={() => {
                  const showHelp = activeSoupDrawerCommand();
                  if (!showHelp) return;
                  runCommand(showHelp);
                }}
                icon={IconQuestion}
                theme="clear"
              />
              <IconButton
                onClick={() => {
                  if(isRightPanelCollapsed()){track(TrackingEvents.RIGHTBAR.OPEN)}
                  else{track(TrackingEvents.RIGHTBAR.CLOSE)}
                  toggleRightPanel();
                }}
                theme={isRightPanelCollapsed() ? 'clear' : 'accent'}
                tooltip={{
                  hotkeyToken: TOKENS.global.toggleRightPanel,
                  label: 'Toggle AI Panel',
                }}
                style={{
                  'aspect-ratio': '1',
                  'height': '100%',
                }}
                icon={IconAtom}
              />

              <IconButton
                tooltip={{
                  hotkeyToken: TOKENS.global.createNewSplit,
                  label: 'Create New Split'
                }}
                onClick={() => {
                  const manager = globalSplitManager();
                  if(manager){
                    manager.createNewSplit({
                      type: 'component',
                      id: 'unified-list',
                    });
                  }
                }}
                style={{
                  'aspect-ratio': '1',
                  'height': '100%',
                }}
                icon={SplitIcon}
                theme="clear"
              />

              <IconButton
                tooltip={{label: isPresentMode() ? 'Exit Present Mode' : 'Enter Present Mode'}}
                theme={isPresentMode() ? 'accent' : 'clear'}
                onClick={togglePresentMode}
                style={{
                  'aspect-ratio': '1',
                  'height': '100%',
                }}
                icon={IconPower}
              />

              <IconButton
                tooltip={{
                  label: settingsOpen() ? 'Close Settings' : 'Open Settings',
                  hotkeyToken: TOKENS.global.toggleSettings,
                }}
                theme={settingsOpen() ? 'accent' : 'clear'}
                onDeepClick={() => {setSettingsOpen(true)}}
                style={{
                  'aspect-ratio': '1',
                  'height': '100%',
                }}
                data-settings-button
                icon={IconGear}
              />
            </div>
          </div>
        </Show>
      </div>

      <PresentModeGlitch
        show={showGlitchEffect()}
        onComplete={() => setShowGlitchEffect(false)}
      />

      <Show when={DEV_MODE_ENV}>
        <div
          onMouseLeave={(e) => {if (!debugOpen()) e.currentTarget.style.opacity = '0.5'}}
          onMouseEnter={(e) => {if (!debugOpen()) e.currentTarget.style.opacity = '1'}}
          style={{
            'transform': debugOpen() ? 'translateX(0)' : 'translateX(100%)',
            'outline': '1px solid rgb(239 68 68)',
            'opacity': debugOpen() ? '1' : '0.5',
            'font-family': 'monospace',
            'transition': 'all 500ms',
            'position': 'absolute',
            'font-size': '0.75rem',
            'line-height': '1rem',
            'cursor': 'pointer',
            'right': '-0.5rem',
            'bottom': '100%',
          }}
          onClick={() => setDebugOpen((p) => !p)}
          title="Click to keep open"
        >
          <h3 style={{
            'transform-origin': 'bottom right',
            'background-color': 'var(--ink)',
            'transform': 'rotate(-90deg)',
            'padding-right': '0.25rem',
            'padding-left': '0.25rem',
            'padding-bottom': '1px',
            'white-space': 'nowrap',
            'position': 'absolute',
            'padding-top': '1px',
            'right': '100%',
            'bottom': '7ch',
          }}>
            Debug
          </h3>
          <ol style={{
            'background-color': 'rgba(var(--ink-rgb), 0.5)',
            'list-style-position': 'inside',
            'list-style-type': 'decimal',
            'flex-direction': 'column',
            'padding-bottom': '1lh',
            'padding-right': '1ch',
            'padding-left': '1ch',
            'padding-top': '1lh',
            'display': 'flex',
          }}>
            <li style={{
              'white-space': 'nowrap',
              'display': 'list-item'
            }}>
              <span style={{
                'background-color': 'var(--ink)',
                'padding-right': '0.25rem',
                'padding-left': '0.25rem',
                'padding-bottom': '1px',
                'padding-top': '1px',
              }}>
                {activeScope()}
              </span>
            </li>
          </ol>
        </div>
      </Show>

    </>
  );
}
