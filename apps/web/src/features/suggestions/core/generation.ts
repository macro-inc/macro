/** What started a generation run. */
export type GenerationTrigger = 'onboarding' | 'nightly' | 'manual';

/** Whether suggestions are being looked for right now, and when a refresh may be asked for. */
export type Generation = {
  state: 'idle' | 'running';
  trigger?: GenerationTrigger;
  startedAt?: string;
  /** Until then a refresh is refused; absent when one may start now. */
  regenerateAvailableAt?: string;
};

/**
 * What the Refresh control shows:
 * - `ready`: a refresh may start.
 * - `running`: suggestions are being looked for, whoever started it.
 * - `cooldown`: one was asked for lately; another may start at `availableAt`.
 */
export type RefreshState =
  | { kind: 'ready' }
  | { kind: 'running' }
  | { kind: 'cooldown'; availableAt: Date };

export function refreshState(generation: Generation, now: Date): RefreshState {
  if (generation.state === 'running') return { kind: 'running' };

  const availableAt = generation.regenerateAvailableAt
    ? new Date(generation.regenerateAvailableAt)
    : undefined;
  if (availableAt && availableAt.getTime() > now.getTime()) {
    return { kind: 'cooldown', availableAt };
  }

  return { kind: 'ready' };
}
