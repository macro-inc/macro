import type {
  AccessRequest,
  RequestState,
} from '@app/features/access-requests/core/types';
import type { Harness } from '@service-storage/client';

/** A machine with its access-request state, once that state has loaded. */
export type MachineRequestState = {
  harness: Harness;
  state: RequestState | undefined;
};

/** One request waiting on a machine. */
export type PendingRequest = { harness: Harness; request: AccessRequest };

/**
 * The requests waiting on the viewer: incoming ones on machines they own,
 * oldest first as each machine lists them, and their own outgoing ones on
 * teammates' machines.
 */
export function pendingRuntimeRequests(
  owned: readonly MachineRequestState[],
  teammates: readonly MachineRequestState[]
): { incoming: PendingRequest[]; outgoing: PendingRequest[] } {
  return {
    incoming: owned.flatMap(({ harness, state }) =>
      (state?.requests ?? [])
        .filter((request) => request.status === 'pending')
        .map((request) => ({ harness, request }))
    ),
    outgoing: teammates.flatMap(({ harness, state }) =>
      state?.mine?.status === 'pending'
        ? [{ harness, request: state.mine }]
        : []
    ),
  };
}

/**
 * How many requests wait on the viewer's machines. A machine lists one page
 * of its requests, so the count comes from its total.
 */
export function incomingRequestCount(
  owned: readonly MachineRequestState[]
): number {
  return owned.reduce(
    (count, { state }) => count + (state?.pendingCount ?? 0),
    0
  );
}
