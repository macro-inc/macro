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
  restoreFocus: () => void,
  /** Whether an automatic open may show now; it waits while this is false. */
  automaticOpenFits: Accessor<boolean>
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
    const automatic =
      defaultRevision() > state.defaultRevision && automaticOpenFits();
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
  // Using an automatic panel makes it the viewer's, so it stays open when the
  // call later narrows below the width where it may open by itself.
  const claim = () => {
    if (view().open && !state.open) open(false);
  };
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
    claim,
    selectTab: (tab: CallPanelTab) => {
      claim();
      setState({ tab, focusOnOpen: false });
    },
  };
}
