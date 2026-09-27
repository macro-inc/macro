/**
 * Pane visibility belongs to the host (see `createPaneViewState`); the split
 * width stays local to the reviewer and scope.
 */

import type { Accessor } from 'solid-js';
import {
  clampChangesShare,
  DEFAULT_CHANGES_SHARE,
  ensureChangesVisible,
  isChangesVisible,
  isSessionVisible,
  type PaneLayout,
  toggleChanges,
  toggleSpotlight,
} from '../core/layout';
import { createPersistedSessionState } from './create-persisted-session-state';

export type PaneLayoutController = {
  layout: Accessor<PaneLayout>;
  changesVisible: Accessor<boolean>;
  sessionVisible: Accessor<boolean>;
  /** Percent of the width the changes pane takes in the split. */
  changesShare: Accessor<number>;
  setChangesShare: (share: number) => void;
  toggle: () => void;
  spotlight: () => void;
  open: () => void;
  close: () => void;
  backToSplit: () => void;
};

type StoredShare = { share: number };

function parseShare(raw: unknown): StoredShare | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { share } = raw as { share?: unknown };
  return typeof share === 'number'
    ? { share: clampChangesShare(share) }
    : undefined;
}

export function createPaneLayout(options: {
  sessionId: Accessor<string | undefined>;
  layout: [get: Accessor<PaneLayout>, set: (layout: PaneLayout) => void];
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}): PaneLayoutController {
  const [layout, setLayout] = options.layout;
  const [stored, setStored] = createPersistedSessionState<StoredShare>({
    sessionId: options.sessionId,
    namespace: 'agent-changes:layout',
    initial: () => ({ share: DEFAULT_CHANGES_SHARE }),
    parse: parseShare,
    storage: options.storage,
  });
  const move = (next: (current: PaneLayout) => PaneLayout) =>
    setLayout(next(layout()));

  return {
    layout,
    changesVisible: () => isChangesVisible(layout()),
    sessionVisible: () => isSessionVisible(layout()),
    changesShare: () => stored().share,
    setChangesShare: (share) => setStored({ share: clampChangesShare(share) }),
    toggle: () => move(toggleChanges),
    spotlight: () => move(toggleSpotlight),
    open: () => move(ensureChangesVisible),
    close: () => setLayout('closed'),
    backToSplit: () => setLayout('split'),
  };
}
