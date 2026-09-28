/**
 * Pane visibility can be controlled by the host URL; the split width and
 * the file tree stay local to the reviewer and session.
 */

import type { Accessor } from 'solid-js';
import {
  clampChangesShare,
  clampFileTreeWidth,
  DEFAULT_CHANGES_SHARE,
  DEFAULT_FILE_TREE_WIDTH,
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
  /** The file tree beside the diffs; hidden until the reviewer asks. */
  fileTreeOpen: Accessor<boolean>;
  toggleFileTree: () => void;
  /** File tree width in pixels. */
  fileTreeWidth: Accessor<number>;
  setFileTreeWidth: (width: number) => void;
  toggle: () => void;
  spotlight: () => void;
  open: () => void;
  close: () => void;
  backToSplit: () => void;
};

type StoredLayout = {
  layout: PaneLayout;
  share: number;
  treeOpen: boolean;
  treeWidth: number;
};

const LAYOUTS: readonly PaneLayout[] = ['split', 'agent-only', 'changes-only'];

function parseStored(raw: unknown): StoredLayout | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { layout, share, treeOpen, treeWidth } = raw as Partial<StoredLayout>;
  if (!layout || !LAYOUTS.includes(layout)) return undefined;
  return {
    layout,
    share: clampChangesShare(typeof share === 'number' ? share : Number.NaN),
    treeOpen: treeOpen === true,
    treeWidth: clampFileTreeWidth(
      typeof treeWidth === 'number' ? treeWidth : Number.NaN
    ),
  };
}

export function createPaneLayout(options: {
  sessionId: Accessor<string | undefined>;
  layout?: [get: Accessor<PaneLayout>, set: (layout: PaneLayout) => void];
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}): PaneLayoutController {
  const [stored, setStored] = createPersistedSessionState<StoredLayout>({
    sessionId: options.sessionId,
    namespace: 'agent-changes:layout',
    initial: () => ({
      layout: 'agent-only',
      share: DEFAULT_CHANGES_SHARE,
      treeOpen: false,
      treeWidth: DEFAULT_FILE_TREE_WIDTH,
    }),
    parse: parseStored,
    storage: options.storage,
  });
  const layout = () => (options.layout ? options.layout[0]() : stored().layout);
  const setLayout = (next: (layout: PaneLayout) => PaneLayout) => {
    if (options.layout) options.layout[1](next(layout()));
    else
      setStored((previous) => ({ ...previous, layout: next(previous.layout) }));
  };

  return {
    layout,
    changesVisible: () => isChangesVisible(layout()),
    sessionVisible: () => isSessionVisible(layout()),
    changesShare: () => stored().share,
    setChangesShare: (share) =>
      setStored((previous) => ({
        ...previous,
        share: clampChangesShare(share),
      })),
    fileTreeOpen: () => stored().treeOpen,
    toggleFileTree: () =>
      setStored((previous) => ({ ...previous, treeOpen: !previous.treeOpen })),
    fileTreeWidth: () => stored().treeWidth,
    setFileTreeWidth: (width) =>
      setStored((previous) => ({
        ...previous,
        treeWidth: clampFileTreeWidth(width),
      })),
    toggle: () => setLayout(toggleChanges),
    spotlight: () => setLayout(toggleSpotlight),
    open: () => setLayout(ensureChangesVisible),
    close: () => setLayout(() => 'agent-only'),
    backToSplit: () => setLayout(() => 'split'),
  };
}
