import { useSearchParams } from '@solidjs/router';
import type { Accessor } from 'solid-js';
import type { DiffStyle, PaneLayout } from './core/layout';
import {
  DIFF_SEARCH_PARAM,
  type DiffUrlState,
  readDiffUrlState,
  writeDiffUrlState,
} from './core/url-state';

/** Read directly from the router so reloads and Back/Forward restore the view. */
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
  return {
    layout: () => state().layout,
    setLayout: (layout: PaneLayout) => update({ layout }),
    diffStyle: () => state().diffStyle,
    setDiffStyle: (diffStyle: DiffStyle) => update({ diffStyle }),
  };
}
