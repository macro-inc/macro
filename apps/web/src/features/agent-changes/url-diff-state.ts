import { useSearchParams } from '@solidjs/router';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import type { DiffStyle, PaneLayout } from './core/layout';
import {
  DIFF_SEARCH_PARAM,
  type DiffUrlState,
  readDiffUrlState,
  removeDiffUrlState,
  writeDiffUrlState,
} from './core/url-state';

/** How many mounted hosts show each scope, so a scope open in two splits keeps its entry. */
const mountedScopes = new Map<string, number>();

function retainScope(id: string) {
  mountedScopes.set(id, (mountedScopes.get(id) ?? 0) + 1);
}

/** Whether no host shows `id` any more. */
function releaseScope(id: string): boolean {
  const count = (mountedScopes.get(id) ?? 1) - 1;
  if (count > 0) {
    mountedScopes.set(id, count);
    return false;
  }
  mountedScopes.delete(id);
  return true;
}

/**
 * Read directly from the router so reloads and Back/Forward restore the view.
 * A host that unmounts or moves to another scope drops the entry it leaves,
 * so reopening that session or PR later starts closed.
 */
export function createUrlDiffState(scopeKey: Accessor<string | undefined>) {
  const [params, setParams] = useSearchParams();
  const state = () => readDiffUrlState(params[DIFF_SEARCH_PARAM], scopeKey());
  const update = (patch: Partial<DiffUrlState>) => {
    const id = scopeKey();
    if (!id) return;
    setParams(
      {
        [DIFF_SEARCH_PARAM]: writeDiffUrlState(params[DIFF_SEARCH_PARAM], id, {
          ...state(),
          ...patch,
        }),
      },
      { replace: false, scroll: false }
    );
  };

  const prune = (id: string) => {
    if (!releaseScope(id)) return;
    // The setter rebuilds the URL from the router's current path, so wait for
    // the navigation that removed this host to land; a host that remounted
    // meanwhile keeps the entry. Replacing keeps Back/Forward restoring it.
    setTimeout(() => {
      if (mountedScopes.has(id)) return;
      const current = params[DIFF_SEARCH_PARAM];
      const next = removeDiffUrlState(current, id);
      if (next === current) return;
      setParams(
        { [DIFF_SEARCH_PARAM]: next },
        { replace: true, scroll: false }
      );
    });
  };
  let retained: string | undefined;
  createEffect(() => {
    const id = scopeKey();
    if (id === retained) return;
    if (id) retainScope(id);
    if (retained) prune(retained);
    retained = id;
  });
  onCleanup(() => {
    if (retained) prune(retained);
    retained = undefined;
  });

  return {
    layout: () => state().layout,
    setLayout: (layout: PaneLayout) => update({ layout }),
    diffStyle: () => state().diffStyle,
    setDiffStyle: (diffStyle: DiffStyle) => update({ diffStyle }),
  };
}
