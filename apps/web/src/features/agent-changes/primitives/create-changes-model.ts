/**
 * What the pane shows, derived from the source: the capture state, the
 * changeset on screen (the latest good one, even while a newer capture runs
 * or has failed), its files as a tree, and the parsed diff for each file.
 */

import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  ChangesSource,
  QueryStatus,
} from '../context/agent-changes-context';
import {
  type ChangedFile,
  type Changeset,
  type ChangesState,
  changesState,
} from '../core/changeset';
import { buildFileTree, type FileTreeNode } from '../core/file-tree';
import {
  type FileDiffEntry,
  matchFilesToDiffs,
  parsePatch,
} from '../core/patch';

export type ChangesModel = {
  state: Accessor<ChangesState>;
  /** The changeset on screen, if any. */
  changeset: Accessor<Changeset | undefined>;
  files: Accessor<ChangedFile[]>;
  tree: Accessor<FileTreeNode[]>;
  /** Files paired with their diffs; undefined until the patch has loaded. */
  entries: Accessor<FileDiffEntry[] | undefined>;
  patchStatus: Accessor<QueryStatus>;
  retryPatch: () => void;
  refresh: () => Promise<void>;
  refreshing: Accessor<boolean>;
  refreshError: Accessor<string | undefined>;
};

export function createChangesModel(options: {
  source: ChangesSource;
  /** Whether the pane is on screen; the patch is only read while it is. */
  changesVisible: Accessor<boolean>;
}): ChangesModel {
  const { source } = options;
  const state = createMemo(() =>
    changesState(source.summary(), source.summaryStatus())
  );
  const changeset = createMemo((): Changeset | undefined => {
    const current = state();
    switch (current.kind) {
      case 'ready':
      case 'empty':
        return current.changeset;
      case 'capturing':
      case 'failed':
        return current.previous;
      case 'loading':
      case 'load_error':
      case 'not_ready':
      case 'none':
        return undefined;
    }
  });
  const files = createMemo(() => changeset()?.files ?? []);
  const tree = createMemo(() => buildFileTree(files()));

  const hasPatch = () => {
    const current = changeset();
    return current !== undefined && current.patchBytes > 0;
  };
  const patch = source.patch(
    () => changeset()?.id,
    () => options.changesVisible() && hasPatch()
  );
  const diffs = createMemo(() => {
    const text = patch.text();
    return text === undefined ? undefined : parsePatch(text);
  });
  const entries = createMemo((): FileDiffEntry[] | undefined => {
    const current = files();
    if (current.length === 0) return [];
    // An empty patch body means every file is binary or omitted; there is
    // nothing to wait for.
    if (!hasPatch()) return matchFilesToDiffs(current, new Map());
    const parsed = diffs();
    return parsed === undefined
      ? undefined
      : matchFilesToDiffs(current, parsed);
  });

  const [refreshing, setRefreshing] = createSignal(false);
  const [refreshError, setRefreshError] = createSignal<string>();
  const refresh = async () => {
    if (refreshing()) return;
    setRefreshing(true);
    setRefreshError(undefined);
    try {
      await source.refresh();
    } catch {
      setRefreshError('The changes could not be refreshed. Try again.');
    } finally {
      setRefreshing(false);
    }
  };

  return {
    state,
    changeset,
    files,
    tree,
    entries,
    patchStatus: patch.status,
    retryPatch: patch.retry,
    refresh,
    refreshing,
    refreshError,
  };
}
