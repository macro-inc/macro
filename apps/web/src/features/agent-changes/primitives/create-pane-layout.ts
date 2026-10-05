/**
 * Pane visibility belongs to the host (see `createPaneViewState`); the split
 * width and whether the file tree shows stay local to the reviewer and scope.
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

export const DEFAULT_TREE_WIDTH = 256;
export const MIN_TREE_WIDTH = 144;
export const MAX_TREE_WIDTH = 480;

function clampTreeWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, width))
    : DEFAULT_TREE_WIDTH;
}
export type PaneLayoutController = {
  layout: Accessor<PaneLayout>;
  changesVisible: Accessor<boolean>;
  sessionVisible: Accessor<boolean>;
  /** Percent of the width the changes pane takes in the split. */
  changesShare: Accessor<number>;
  setChangesShare: (share: number) => void;
  /** The file tree shows beside the diffs. */
  treeOpen: Accessor<boolean>;
  toggleTree: () => void;
  /** Preferred width in pixels of the file tree. */
  treeWidth: Accessor<number>;
  setTreeWidth: (width: number) => void;
  toggle: () => void;
  spotlight: () => void;
  open: () => void;
  close: () => void;
};

type StoredLayout = { share: number; treeOpen: boolean; treeWidth: number };

function parseLayout(raw: unknown): StoredLayout | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { share, treeOpen, treeWidth } = raw as {
    share?: unknown;
    treeOpen?: unknown;
    treeWidth?: unknown;
  };
  return {
    share:
      typeof share === 'number'
        ? clampChangesShare(share)
        : DEFAULT_CHANGES_SHARE,
    treeOpen: typeof treeOpen === 'boolean' ? treeOpen : true,
    treeWidth:
      typeof treeWidth === 'number'
        ? clampTreeWidth(treeWidth)
        : DEFAULT_TREE_WIDTH,
  };
}

export function createPaneLayout(options: {
  sessionId: Accessor<string | undefined>;
  layout: [get: Accessor<PaneLayout>, set: (layout: PaneLayout) => void];
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}): PaneLayoutController {
  const [layout, setLayout] = options.layout;
  const [stored, setStored] = createPersistedSessionState<StoredLayout>({
    sessionId: options.sessionId,
    namespace: 'agent-changes:layout',
    initial: () => ({
      share: DEFAULT_CHANGES_SHARE,
      treeOpen: true,
      treeWidth: DEFAULT_TREE_WIDTH,
    }),
    parse: parseLayout,
    storage: options.storage,
  });
  const move = (next: (current: PaneLayout) => PaneLayout) =>
    setLayout(next(layout()));

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
    treeOpen: () => stored().treeOpen,
    toggleTree: () =>
      setStored((previous) => ({ ...previous, treeOpen: !previous.treeOpen })),
    treeWidth: () => stored().treeWidth,
    setTreeWidth: (width) =>
      setStored((previous) => ({
        ...previous,
        treeWidth: clampTreeWidth(width),
      })),
    toggle: () => move(toggleChanges),
    spotlight: () => move(toggleSpotlight),
    open: () => move(ensureChangesVisible),
    close: () => setLayout('closed'),
  };
}
