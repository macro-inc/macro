import { createSignal } from 'solid-js';

// Retire live observer snapshots as well as persisted rows after a permission change.
const [state, setState] = createSignal({ epoch: 0, paused: false });
export const crmSnapshotAuthorization = state;
/** Capture before dispatch; retirement never grants an old response a new epoch. */
export function captureQueryAuthorization(): () => boolean {
  const epoch = state().epoch;
  return () => !state().paused && state().epoch === epoch;
}
export function beginQueryAuthorizationReset() {
  const epoch = state().epoch + 1;
  setState({ epoch, paused: true });
  return () => {
    if (state().epoch === epoch) setState({ epoch, paused: false });
  };
}

// Later enqueues retain command variables but carry no stale snapshot.
export async function runOptimisticCacheWrite<T>(
  snapshotEpoch: number | undefined,
  write: (acceptSnapshot: boolean) => Promise<T>
): Promise<T> {
  const state = crmSnapshotAuthorization();
  const accepted =
    !state.paused && (snapshotEpoch ?? state.epoch) === state.epoch;
  return write(accepted);
}
