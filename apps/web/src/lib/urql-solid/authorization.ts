import { createSignal } from 'solid-js';

// Retire live observer snapshots as well as persisted rows after a permission change.
const [state, setState] = createSignal({ epoch: 0, paused: false });
export const queryAuthorization = state;
export function beginQueryAuthorizationReset() {
  const epoch = state().epoch + 1;
  setState({ epoch, paused: true });
  return () => {
    if (state().epoch === epoch) setState({ epoch, paused: false });
  };
}

// An enqueue admitted before retirement must settle before copied responses are
// removed. Later enqueues retain command variables but carry no stale snapshot.
const optimisticWrites = new Set<Promise<void>>();
export async function runOptimisticCacheWrite<T>(
  snapshotEpoch: number | undefined,
  write: (acceptSnapshot: boolean) => Promise<T>
): Promise<T> {
  const state = queryAuthorization();
  const accepted =
    !state.paused && (snapshotEpoch ?? state.epoch) === state.epoch;
  let settle!: () => void;
  const pending = new Promise<void>((resolve) => {
    settle = resolve;
  });
  optimisticWrites.add(pending);
  try {
    return await write(accepted);
  } finally {
    optimisticWrites.delete(pending);
    settle();
  }
}
export async function settleOptimisticCacheWrites(): Promise<void> {
  await Promise.all([...optimisticWrites]);
}
