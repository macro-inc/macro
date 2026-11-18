import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { t } from '@app/lib/i18n';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { getRunnableHotkeys } from '@core/hotkey/getCommands';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { activeScope, clearPressedKeys } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { activateClosestDOMScope } from '@core/hotkey/utils';
import { debounce } from '@solid-primitives/scheduled';
import { createSignal, onCleanup } from 'solid-js';

/** Whether the "g" leader key is currently awaiting a destination key. */
const [goToHotkeyVisible, setGoToHotkeyVisible] = createSignal(false);

/**
 * True while the "g" leader awaits a destination, so nav buttons can show
 * their destination key. Any key in the GoTo scope leaves it, including a
 * view's own GoTo command (Email's g s), so the hints clear with it.
 */
export const isGoToLeaderActive = () =>
  goToHotkeyVisible() && activeScope() === GO_TO_COMMAND_SCOPE;

const resetGoToHotkeysState = () => {
  setGoToHotkeyVisible(false);
  // To prevent the next key from triggering the hotkey handler,
  // we reset the pressed keys state and exit the command scope
  clearPressedKeys();
  activateClosestDOMScope();
};

/**
 * Registers "g" as the leader that activates the global GoTo command scope.
 * Returns `leave`, which a destination calls once it fires.
 */
export function useGoToLeader() {
  // Any key already left the GoTo scope, and the destination it reached may
  // have focused an input since. Exiting again would refocus the split.
  const debounceResetHotkeysState = debounce(() => {
    if (activeScope() === GO_TO_COMMAND_SCOPE) resetGoToHotkeysState();
    else setGoToHotkeyVisible(false);
  }, 2000);
  const debounceSetHotkeyVisible = debounce(
    () => setGoToHotkeyVisible(true),
    200
  );

  const leaderHotkey = registerHotkey({
    hotkey: GO_TO_LEADER_KEY,
    scopeId: 'global',
    hotkeyToken: TOKENS.sidebar.goToLeader,
    description: () => t('nav.goToPage'),
    keyDownHandler: () => {
      // We debounce the time till the hot keys are visible to allow other commands
      // like g+g to fire
      debounceSetHotkeyVisible();
      debounceResetHotkeysState();
      return true;
    },
    activateCommandScopeId: GO_TO_COMMAND_SCOPE,
    hide: true,
    registrationType: 'add',
  });

  // The leader registers in the 'global' scope, which outlives its component,
  // so dispose it on unmount. Otherwise a remount (e.g. crossing the mobile
  // breakpoint) stacks duplicate 'add' handlers.
  onCleanup(() => {
    leaderHotkey.dispose();
    debounceResetHotkeysState.clear();
    debounceSetHotkeyVisible.clear();
  });

  // When the go to command scope is active, we want to prevent
  // other default hotkeys from running. So doing "g" + some key
  // not part of the sidebar hotkeys, won't fire the command
  // for the key
  useHotkeyInterceptor((context) => {
    // If a hotkey is going to be fired, but the hotkeys are not
    // visible, then it's not a sidebar nav hotkey and we can
    // ignore it and reset our visible state
    if (!goToHotkeyVisible()) {
      debounceSetHotkeyVisible.clear();
      return false;
    }

    if (context.eventType !== 'keydown') return false;

    if (
      context.activeScopeId !== GO_TO_COMMAND_SCOPE ||
      // The sidebar's letters and those a focused view adds (Email's g s).
      getRunnableHotkeys(GO_TO_COMMAND_SCOPE).has(context.pressedKeysString)
    ) {
      return false;
    }

    resetGoToHotkeysState();
    debounceResetHotkeysState.clear();

    return true;
  });

  const leave = () => {
    debounceSetHotkeyVisible.clear();
    debounceResetHotkeysState.clear();
    if (goToHotkeyVisible()) resetGoToHotkeysState();
  };

  return { leave };
}
