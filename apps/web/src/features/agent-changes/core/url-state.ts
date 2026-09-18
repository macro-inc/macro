import type { DiffStyle, PaneLayout } from './layout';

export type DiffUrlState = { layout: PaneLayout; diffStyle: DiffStyle };

export const DEFAULT_DIFF_URL_STATE: DiffUrlState = {
  layout: 'agent-only',
  diffStyle: 'unified',
};

/** Each tuple belongs to a host, so adjacent viewers stay independent. */
function entries(value: unknown): Map<string, DiffUrlState> {
  const result = new Map<string, DiffUrlState>();
  if (typeof value !== 'string') return result;
  for (const entry of value.split(',')) {
    const [scopeKey, layout, diffStyle, extra] = entry.split(':');
    if (
      !scopeKey ||
      extra !== undefined ||
      (layout !== 'agent-only' &&
        layout !== 'split' &&
        layout !== 'changes-only') ||
      (diffStyle !== 'unified' && diffStyle !== 'split')
    )
      continue;
    try {
      result.set(decodeURIComponent(scopeKey), { layout, diffStyle });
    } catch {
      // Ignore malformed URL entries without disturbing the other viewers.
    }
  }
  return result;
}

export function readDiffUrlState(
  value: unknown,
  scopeKey: string | undefined
): DiffUrlState {
  return (
    (scopeKey ? entries(value).get(scopeKey) : undefined) ??
    DEFAULT_DIFF_URL_STATE
  );
}

export function writeDiffUrlState(
  value: unknown,
  scopeKey: string,
  state: DiffUrlState
): string | undefined {
  const next = entries(value);
  if (state.layout === 'agent-only' && state.diffStyle === 'unified') {
    next.delete(scopeKey);
  } else {
    next.set(scopeKey, state);
  }
  return (
    [...next]
      .map(
        ([id, state]) =>
          `${encodeURIComponent(id)}:${state.layout}:${state.diffStyle}`
      )
      .join(',') || undefined
  );
}
