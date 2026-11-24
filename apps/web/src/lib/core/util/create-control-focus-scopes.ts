import { onCleanup } from 'solid-js';

/** Aggregate overlapping control focus scopes, including their closing transitions. */
export function createControlFocusScopes<Key extends string>(
  onChange: (active: boolean) => void
) {
  const scopes = new Set<Key>();
  let active = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    scopes.clear();
    if (active) onChange(false);
  });
  return (key: Key, open: boolean) => {
    if (disposed) return;
    if (open) scopes.add(key);
    else scopes.delete(key);
    const next = scopes.size > 0;
    if (active === next) return;
    active = next;
    onChange(next);
  };
}
