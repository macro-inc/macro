import { type Accessor, createMemo, createSignal } from 'solid-js';
import { defaultCollapsedPaths } from './model/collapse';
import type { DiffFile } from './model/diff-file';

/** Which files show their diff. A host that persists it supplies its own. */
export type DiffCollapse = {
  isCollapsed: (path: string) => boolean;
  toggle: (path: string) => void;
  /** Collapse every file, or expand them all when none is open. */
  toggleAll: () => void;
  anyExpanded: Accessor<boolean>;
};

/** Collapse state kept in memory for as long as the view is mounted. */
export function createDiffCollapse(
  files: Accessor<readonly Pick<DiffFile, 'path' | 'additions' | 'deletions'>[]>
): DiffCollapse {
  const defaults = createMemo(() => new Set(defaultCollapsedPaths(files())));
  const [overrides, setOverrides] = createSignal<ReadonlyMap<string, boolean>>(
    new Map()
  );
  const isCollapsed = (path: string) =>
    overrides().get(path) ?? defaults().has(path);
  const anyExpanded = () => files().some((file) => !isCollapsed(file.path));
  return {
    isCollapsed,
    toggle: (path) => {
      const collapsed = !isCollapsed(path);
      setOverrides((previous) => new Map(previous).set(path, collapsed));
    },
    toggleAll: () => {
      const collapsed = anyExpanded();
      setOverrides(new Map(files().map((file) => [file.path, collapsed])));
    },
    anyExpanded,
  };
}
