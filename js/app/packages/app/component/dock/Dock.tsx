import { setSettingsOpen, useSettingsState } from '@core/constant/SettingsState';
import { GlobalNotificationBell } from '@core/component/GlobalNotificationBell';
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { isRightPanelOpen, useToggleRightPanel } from '@core/signal/layout';
import { ENABLE_DOCK_NOTITIFCATIONS } from '@core/constant/featureFlags';
import { /* Hotkey, */ BasicHotkey } from '@core/component/Hotkey';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import SplitIcon from '@icon/regular/square-split-horizontal.svg';
import { useGlobalNotificationSource } from '../GlobalAppState';
import IconPower from '@phosphor-icons/core/regular/power.svg';
import MacroCreateIcon from '@macro-icons/macro-create-b.svg';
import { globalSplitManager } from '@app/signal/splitLayout';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { PresentModeGlitch } from './PresentModeGlitch';
import { IconButton } from '@core/component/IconButton';
import IconQuestion from '@icon/regular/question.svg';
import { withAnalytics } from '@coparse/analytics';
import IconAtom from '@macro-icons/macro-atom.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import IconLogo from '@macro-icons/macro-logo.svg';
import { BasicTierLimit } from './BasicTierLimit';
import { setKonsoleOpen } from '../command/state';
import { runCommand } from '@core/hotkey/hotkeys';
import { cornerClip } from '@core/util/clipPath';
import { setCreateMenuOpen } from '../Launcher';
import { useHasPaidAccess } from '@core/auth';
import { TOKENS } from '@core/hotkey/tokens';
import { playSound } from '@app/util/sound';
import { QuickAccess } from './QuickAccess';

// import { Debug } from './Debug';
import Hints from './Hints';

export function Dock(){
  const activeSplitId = createMemo(() => globalSplitManager()?.activeSplitId());
  const [showGlitchEffect, setShowGlitchEffect] = createSignal(false);
  const [isPresentMode, setIsPresentMode] = createSignal(false);
  const notificationSource = useGlobalNotificationSource();
  const isRightPanelCollapsed = () => !isRightPanelOpen();
  // const [debugOpen, setDebugOpen] = createSignal(false);
  const { track, TrackingEvents } = withAnalytics();
  const toggleRightPanel = useToggleRightPanel();
  const { settingsOpen } = useSettingsState();
  const hasPaid = useHasPaidAccess();

  const isSoupActive = createMemo(() => {
    const splitId = globalSplitManager()?.activeSplitId();
    if(!splitId){return false};
    const split = globalSplitManager()?.getSplit(splitId);
    if(!split){return false};
    return split.content().id === 'unified-list';
  });

  // This method of opening the correct help drawer is disgusting,
  // but it works and doesn't require changing anything else.
  function activeSoupDrawerCommand(){
    const currentActiveScope = activeScope();
    if(!currentActiveScope){return undefined};
    let activeScopeNode = hotkeyScopeTree.get(currentActiveScope);
    if(!activeScopeNode){return undefined};
    if(activeScopeNode?.type !== 'dom'){return};
    const dom = activeScopeNode.element;
    const closestSplitScope = dom.closest('[data-hotkey-scope^="split"]');
    if(!closestSplitScope || !(closestSplitScope instanceof HTMLElement)){return};
    const scopeId = closestSplitScope.dataset.hotkeyScope;
    if(!scopeId){return undefined};
    const splitNode = hotkeyScopeTree.get(scopeId);
    if(!splitNode){return undefined};
    return splitNode.hotkeyCommands.get('shift+/');
  };

  async function enterPresentMode(){
    try{
      playSound('Stab_Destruct');
      const element = document.documentElement;
      if(element.requestFullscreen){await element.requestFullscreen()}
      else if((element as any).webkitRequestFullscreen){await (element as any).webkitRequestFullscreen()}// Safari
      else if((element as any).mozRequestFullScreen){await (element as any).mozRequestFullScreen()}// Firefox
      else if((element as any).msRequestFullscreen){await (element as any).msRequestFullscreen()}// IE/Edge
      focusActiveSplit();
    }
    catch(error){
      console.error('Error entering present mode:', error);
    }
  };

  async function exitPresentMode(){
    try{
      if(document.exitFullscreen){await document.exitFullscreen()}
      else if((document as any).webkitExitFullscreen){await (document as any).webkitExitFullscreen()}// Safari
      else if((document as any).mozCancelFullScreen){await (document as any).mozCancelFullScreen()}// Firefox
      else if((document as any).msExitFullscreen){await (document as any).msExitFullscreen()}// IE/Edge
      focusActiveSplit();
    }
    catch(error){
      console.error('Error exiting present mode:', error);
    }
  };

  async function focusActiveSplit(){
    const id = activeSplitId();
    if (!id) return null;
    const splitEl = document.querySelector(`[data-split-id="${id}"]`) as HTMLElement;
    splitEl?.focus();
  };

  function togglePresentMode(){
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
  function checkFullscreen(){
    const isFullscreen = document.fullscreenElement || (document as any).webkitFullscreenElement || (document as any).mozFullScreenElement || (document as any).msFullscreenElement;
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
          'padding': '0 0.5rem 0.5rem 0.5rem'
        }}
      >
        <div style={{
          'clip-path': cornerClip(0, 0, '0.5rem', '0.5rem'),
          'background-color': 'var(--color-edge-muted)',
          'height': '40px',
        }}>
        <div style={{
          'clip-path': cornerClip(0, 0, 'calc(0.5rem + 1.5px)', 'calc(0.5rem + 1.5px)'),
          'grid-template-columns':'min-content 1fr min-content',
          'border': '1px solid var(--color-edge-muted)',
          'background-color': 'var(--color-panel)',
          'box-sizing': 'border-box',
          'scrollbar-width': 'none',
          'align-content': 'center',
          'overflow-y': 'hidden',
          'padding': '0 7px',
          'display': 'grid',
          'height': '40px',
          'z-index': '1',
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
              onClick={() => {setKonsoleOpen(true)}}
              class="dock-button-hover"
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
              <div class="**:border-none! flex size-full">
                <BasicHotkey shortcut="cmd+k" />
              </div>
            </div>

            <div style={{
              'background-color': 'var(--color-edge-muted)',
              'height': '38px',
              'width': '1px',
            }}/>

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
              onClick={() => {setCreateMenuOpen(true)}}
              class="dock-button-hover"
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
              <div class="**:border-none! flex size-full">
                <BasicHotkey shortcut="c" />
              </div>
            </div>
          </div>

          <Show when={!isMobileWidth()}>
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

              <Show when={hasPaid()}>
                <Hints />
              </Show>

              <Show when={ENABLE_DOCK_NOTITIFCATIONS}>
                <QuickAccess />
                <GlobalNotificationBell notificationSource={notificationSource} />
              </Show>
            </div>
          </Show>

          <Show when={isMobileWidth()}>
            <div></div>
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
            <Show when={isSoupActive()}>
              <IconButton
                onClick={() => {
                  const showHelp = activeSoupDrawerCommand();
                  if(!showHelp){return};
                  runCommand(showHelp);
                }}
                tooltip={{
                  hotkeyToken: TOKENS.split.showHelpDrawer,
                  label: 'Help',
                }}
                icon={IconQuestion}
                theme="clear"
                size="sm"
              />
            </Show>

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
              icon={IconAtom}
              size="sm"
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
                    id: 'unified-list',
                    type: 'component',
                  });
                }
              }}
              icon={SplitIcon}
              theme="clear"
              size="sm"
            />

            <IconButton
              tooltip={{label: isPresentMode() ? 'Exit Present Mode' : 'Enter Present Mode'}}
              theme={isPresentMode() ? 'accent' : 'clear'}
              onClick={togglePresentMode}
              icon={IconPower}
              size="sm"
            />

            <IconButton
              tooltip={{
                label: settingsOpen() ? 'Close Settings' : 'Open Settings',
                hotkeyToken: TOKENS.global.toggleSettings,
              }}
              theme={settingsOpen() ? 'accent' : 'clear'}
              onDeepClick={() => {setSettingsOpen(true)}}
              icon={IconGear}
              size="sm"
            />
          </div>

        </div>
        </div>
      </div>

      <PresentModeGlitch
        show={showGlitchEffect()}
        onComplete={() => setShowGlitchEffect(false)}
      />

      {/*<Show when={DEV_MODE_ENV}>
        <Debug/>
      </Show>*/}
    </>
  );
}
