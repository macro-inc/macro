import { type Accessor, createSignal } from 'solid-js';

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
  paths: Accessor<readonly string[]>
): DiffCollapse {
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(
    new Set()
  );
  const anyExpanded = () => paths().some((path) => !collapsed().has(path));
  return {
    isCollapsed: (path) => collapsed().has(path),
    toggle: (path) =>
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    toggleAll: () =>
      setCollapsed(anyExpanded() ? new Set(paths()) : new Set<string>()),
    anyExpanded,
  };
}
