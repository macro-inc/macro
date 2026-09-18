import type { DiffStyle, PaneLayout } from './layout';

export type DiffUrlState = { layout: PaneLayout; diffStyle: DiffStyle };

export const DEFAULT_DIFF_URL_STATE: DiffUrlState = {
  layout: 'agent-only',
  diffStyle: 'unified',
};

/** Each tuple belongs to a session, so adjacent session panes stay independent. */
function entries(value: unknown): Map<string, DiffUrlState> {
  const result = new Map<string, DiffUrlState>();
  if (typeof value !== 'string') return result;
  for (const entry of value.split(',')) {
    const [sessionId, layout, diffStyle, extra] = entry.split(':');
    if (
      !sessionId ||
      extra !== undefined ||
      (layout !== 'agent-only' &&
        layout !== 'split' &&
        layout !== 'changes-only') ||
      (diffStyle !== 'unified' && diffStyle !== 'split')
    )
      continue;
    result.set(sessionId, { layout, diffStyle });
  }
  return result;
}

export function readDiffUrlState(
  value: unknown,
  sessionId: string | undefined
): DiffUrlState {
  return (
    (sessionId ? entries(value).get(sessionId) : undefined) ??
    DEFAULT_DIFF_URL_STATE
  );
}

export function writeDiffUrlState(
  value: unknown,
  sessionId: string,
  state: DiffUrlState
): string | undefined {
  const next = entries(value);
  if (state.layout === 'agent-only' && state.diffStyle === 'unified') {
    next.delete(sessionId);
  } else {
    next.set(sessionId, state);
  }
  return (
    [...next]
      .map(([id, state]) => `${id}:${state.layout}:${state.diffStyle}`)
      .join(',') || undefined
  );
}
