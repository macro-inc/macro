import { onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

type CallMoreMenuState = {
  menuOpen: boolean;
  shortcutsOpen: boolean;
  shortcutsRequested: boolean;
  interactedOutside: boolean;
};

export function createCallMoreMenu(onOpenChange: (open: boolean) => void) {
  const [state, setState] = createStore<CallMoreMenuState>({
    menuOpen: false,
    shortcutsOpen: false,
    shortcutsRequested: false,
    interactedOutside: false,
  });
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const setMenuOpen = (open: boolean) => {
    setState('menuOpen', open);
    onOpenChange(open || state.shortcutsOpen || state.shortcutsRequested);
  };
  const setShortcutsOpen = (open: boolean) => {
    setState({
      shortcutsOpen: open,
      ...(open ? { interactedOutside: false } : {}),
    });
    onOpenChange(open || state.menuOpen);
  };
  return {
    state,
    setMenuOpen,
    setShortcutsOpen,
    requestShortcuts: () => {
      setState('shortcutsRequested', true);
      setMenuOpen(false);
    },
    finishMenuClose: () => {
      if (!state.shortcutsRequested) return state.shortcutsOpen;
      setState('shortcutsRequested', false);
      queueMicrotask(() => {
        if (!disposed) setShortcutsOpen(true);
      });
      return true;
    },
    interactOutside: () => setState('interactedOutside', true),
  };
}
