import { withAnalytics } from '@coparse/analytics';
import { IconButton } from '@core/component/IconButton';

const { track, TrackingEvents } = withAnalytics();

import { globalSplitManager } from '@app/signal/splitLayout';
import { useHasPaidAccess } from '@core/auth';
import { GlobalNotificationBell } from '@core/component/GlobalNotificationBell';
import { BasicHotkey } from '@core/component/Hotkey';
import {
  DEV_MODE_ENV,
  ENABLE_DOCK_NOTITIFCATIONS,
  ENABLE_RIGHTHAND_SIDEBAR,
} from '@core/constant/featureFlags';
import {
  setSettingsOpen,
  useSettingsState,
} from '@core/constant/SettingsState';
import { runCommand } from '@core/hotkey/hotkeys';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { isRightPanelOpen, useToggleRightPanel } from '@core/signal/layout';
import IconQuestion from '@icon/regular/question.svg';
import SplitIcon from '@icon/regular/square-split-horizontal.svg';
import IconAtom from '@macro-icons/macro-atom.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import { createMemo, createSignal, Show } from 'solid-js';
import { setKonsoleOpen } from '../command/state';
import { useGlobalNotificationSource } from '../GlobalAppState';
import { BasicTierLimit } from './BasicTierLimit';
import { CreateMenu } from './CreateMenu';
import Hints from './Hints';
import { QuickAccess } from './QuickAccess';

export function Dock() {
  const hasPaid = useHasPaidAccess();
  const { settingsOpen } = useSettingsState();
  const toggleRightPanel = useToggleRightPanel();
  const isRightPanelCollapsed = () => !isRightPanelOpen();

  const notificationSource = useGlobalNotificationSource();

  const isSoupActive = createMemo(() => {
    const splitId = globalSplitManager()?.activeSplitId();
    if (!splitId) return false;
    const split = globalSplitManager()?.getSplit(splitId);
    if (!split) return false;
    return split.content().id === 'unified-list';
  });
  // This method of opening the correct help drawer is disgusting, but it works and doesn't require changing anything else.
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

  return (
    <Show when={!isMobileWidth()}>
      <div class="z-1 relative flex shrink-0 bg-panel">
        <div
          onMouseDown={() => setKonsoleOpen(true)}
          class="group *:border-b-0 *:h-full relative border-t border-edge-muted flex justify-between items-center gap-2 pl-3 py-2"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="text-ink-muted group-hover:text-accent transition-all duration-300 size-6 mb-px"
            viewBox="0 0 185.062 122.8"
          >
            <path
              d="M48.143,0l-17.298,6.784v44.891l10.281,9.711v9.738l-10.281-9.72v-9.729l-13.547-12.792L0,45.664v51.515c0,.98.2,1.95.587,2.85.388.9.955,1.712,1.667,2.386l21.558,20.385,17.313-6.781v-44.891l54.654,51.673,17.313-6.781v-44.891l54.672,51.673,17.298-6.781v-51.515c0-.98-.2-1.95-.587-2.85-.388-.9-.955-1.712-1.667-2.385L120.127,0l-17.316,6.784v44.891l10.281,9.717-.1,9.638-10.181-9.623v-9.732L48.143,0Z"
              fill="currentColor"
            />
          </svg>
          <div class="**:border-none! flex size-full">
            <BasicHotkey shortcut="cmd+k" />
          </div>
        </div>

        <div class="*:border-b-0 *:h-full">
          <CreateMenu />
        </div>
        <Show when={DEV_MODE_ENV}>
          <div
            class="-right-2 bottom-full absolute opacity-50 hover:opacity-100 outline outline-red-500right-0 font-mono text-dialog text-xs transition translate-x-full hover:translate-0 duration-500"
            title="Click to keep open"
            classList={{
              'translate-0!': debugOpen(),
            }}
            onClick={() => setDebugOpen((p) => !p)}
          >
            <h3 class="right-full bottom-[7ch] absolute bg-ink px-1 py-px whitespace-nowrap -rotate-90 origin-bottom-right">
              Debug
            </h3>
            <ol class="flex flex-col bg-ink/50 px-[1ch] py-[1lh] list-decimal list-inside">
              <li class="whitespace-nowrap list-item">
                <span class="bg-ink px-1 py-px">{activeScope()}</span>
              </li>
            </ol>
          </div>
        </Show>

        <Show when={!hasPaid()}>
          <BasicTierLimit />
        </Show>

        <div class="flex flex-1 justify-center items-center gap-6 px-6 border-edge-muted border-t font-mono text-ink-extra-muted text-xs">
          <Show when={hasPaid()}>
            <Hints />
          </Show>
          <Show when={ENABLE_DOCK_NOTITIFCATIONS}>
            <QuickAccess />
            <GlobalNotificationBell notificationSource={notificationSource} />
          </Show>
        </div>

        <div class="flex items-stretch border-edge-muted border-t border-r">
          <IconButton
            icon={IconQuestion}
            theme="clear"
            class="h-full aspect-square"
            classList={{
              'opacity-0 pointer-events-none': !isSoupActive(),
            }}
            tooltip={{
              label: 'Help',
              hotkeyToken: TOKENS.split.showHelpDrawer,
            }}
            onClick={() => {
              const showHelp = activeSoupDrawerCommand();
              if (!showHelp) return;
              runCommand(showHelp);
            }}
          />
          <Show when={ENABLE_RIGHTHAND_SIDEBAR}>
            <IconButton
              icon={IconAtom}
              theme={isRightPanelCollapsed() ? 'clear' : 'accent'}
              tooltip={{
                label: 'Toggle AI Panel',
                hotkeyToken: TOKENS.global.toggleRightPanel,
              }}
              class="h-full aspect-square"
              onClick={() => {
                if (isRightPanelCollapsed()) {
                  track(TrackingEvents.RIGHTBAR.OPEN);
                } else {
                  track(TrackingEvents.RIGHTBAR.CLOSE);
                }
                toggleRightPanel();
              }}
            />
          </Show>

          <IconButton
            icon={SplitIcon}
            theme="clear"
            tooltip={{
              label: 'Create New Split',
              hotkeyToken: TOKENS.global.createNewSplit,
            }}
            class="h-full aspect-square"
            onClick={() => {
              const manager = globalSplitManager();
              if (manager) {
                manager.createNewSplit({
                  type: 'component',
                  id: 'unified-list',
                });
              }
            }}
          />

          <IconButton
            icon={IconGear}
            theme={settingsOpen() ? 'accent' : 'clear'}
            tooltip={{
              label: settingsOpen() ? 'Close Settings' : 'Open Settings',
              hotkeyToken: TOKENS.global.toggleSettings,
            }}
            class="h-full aspect-square"
            data-settings-button
            onDeepClick={() => {
              setSettingsOpen(true);
            }}
          />
        </div>
      </div>
    </Show>
  );
}
