import { type Accessor, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { CallPanelTab } from '../chat/components/CallChatPanel';

type CallPanelState = {
  open: boolean;
  mounted: boolean;
  tab: CallPanelTab;
  focusOnOpen: boolean;
  defaultRevision: number;
};

export function createCallPanel(
  opensByDefault: Accessor<boolean>,
  restoreFocus: () => void
) {
  // Remember each automatic-open transition without copying it into UI state.
  // Explicit close records the revision, so the same discussion cannot reopen it.
  const defaultOpen = createMemo(opensByDefault);
  const defaultRevision = createMemo(
    (previous: number) => (defaultOpen() ? previous + 1 : previous),
    0
  );
  const [state, setState] = createStore<CallPanelState>({
    open: false,
    mounted: false,
    tab: 'chat',
    focusOnOpen: true,
    defaultRevision: 0,
  });
  const view = createMemo(() => {
    const automatic = defaultRevision() > state.defaultRevision;
    return {
      open: automatic || state.open,
      mounted: defaultRevision() > 0 || state.mounted,
      tab: state.tab,
      focusOnOpen: automatic ? false : state.focusOnOpen,
    };
  });
  const open = (focusOnOpen: boolean, tab = state.tab) =>
    setState({
      open: true,
      mounted: true,
      tab,
      focusOnOpen,
      defaultRevision: defaultRevision(),
    });
  const close = () => {
    setState({ open: false, defaultRevision: defaultRevision() });
    restoreFocus();
  };
  return {
    get state() {
      return view();
    },
    open,
    close,
    toggle: () => {
      if (view().open) close();
      else open(true);
    },
    selectTab: (tab: CallPanelTab) => setState({ tab, focusOnOpen: false }),
  };
}
