import { createCallback } from '@solid-primitives/rootless';
import { useContext } from 'solid-js';
import { SplitLayoutContext, SplitPanelContext } from './context';
import type { SplitContent, SplitManager } from './layoutManager';

export function decodePairs(segments: string[]): SplitContent[] {
  const pairs: SplitContent[] = [];
  for (let i = 0; i < segments.length; i += 2) {
    const type = segments[i];
    const id = segments[i + 1];
    if (!type || !id) break;
    pairs.push(
      type === 'component'
        ? { type: 'component', id }
        : ({ type, id } as SplitContent)
    );
  }
  return pairs.length ? pairs : [{ type: 'component', id: 'unified-list' }];
}

export function encodePairs(splits: ReadonlyArray<SplitContent>): string[] {
  return splits.flatMap((s) => [s.type, s.id]);
}

export const isInSplit = createCallback(() => {
  return !!useContext(SplitPanelContext);
});

export const isInSplitLayout = createCallback(() => {
  return !!useContext(SplitLayoutContext);
});

export const getSplitPanelRef = createCallback(() => {
  const ctx = useContext(SplitPanelContext);
  if (!ctx) return null;
  return ctx.panelRef() ?? null;
});

/**
 * Get the context value for the the SplitPanel.
 * @throws if used outside of a properly set up <SplitPanel/>
 * @returns
 */
export function useSplitPanelOrThrow() {
  const ctxValue = useContext(SplitPanelContext);
  if (ctxValue === undefined) {
    console.trace(
      'You are trying to access SplitPanelContext outside of a <SplitPanel />!'
    );
    throw new Error(
      'You are trying to access SplitPanelContext outside of a <SplitPanel />!'
    );
  }
  return ctxValue;
}

/**
 * Get the context value for the the SplitPanel with possible undefined.
 * @returns
 */
export function useSplitPanel() {
  return useContext(SplitPanelContext);
}

export function globalRemoveFromSplitHistory(
  manager: SplitManager,
  test: (item: SplitContent) => boolean
) {
  for (const split of manager.splits()) {
    const handle = manager.getSplit(split.id);
    handle?.removeFromHistory(test);
  }
}
