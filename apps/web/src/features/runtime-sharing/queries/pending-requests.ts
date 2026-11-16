import { useIsAuthenticated } from '@core/auth';
import { useUserId } from '@core/context/user';
import { useAccessRequestStates } from '@queries/access-requests/requests';
import {
  useHarnessDirectoryQuery,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import type { Harness } from '@service-storage/client';
import type { Accessor } from 'solid-js';
import {
  incomingRequestCount,
  type MachineRequestState,
  pendingRuntimeRequests,
} from '../core/pending-requests';

const harnessEntity = (harness: Harness) => ({
  entityType: 'harness' as const,
  entityId: harness.id,
});

function useMachineRequestStates(
  machines: Accessor<Harness[]>
): Accessor<MachineRequestState[]> {
  const authenticated = useIsAuthenticated();
  const states = useAccessRequestStates(
    () => machines().map(harnessEntity),
    () => !!authenticated()
  );
  return () =>
    machines().map((harness, index) => ({
      harness,
      state: states[index]?.data,
    }));
}

/** The machines the viewer owns, with the requests waiting on each. */
function useOwnedMachineRequests() {
  const harnesses = useHarnessesQuery();
  return useMachineRequestStates(() =>
    harnesses.isSuccess
      ? harnesses.data.filter((harness) => harness.access === 'owner')
      : []
  );
}

/**
 * Requests waiting on the viewer: incoming on machines they own, and their
 * own outgoing ones on teammates' machines they cannot run agents on yet.
 */
export function usePendingRuntimeRequests() {
  const userId = useUserId();
  const directory = useHarnessDirectoryQuery();
  const owned = useOwnedMachineRequests();
  const teammates = useMachineRequestStates(() =>
    directory.isSuccess
      ? directory.data.filter(
          (harness) =>
            !(
              harness.owner.type === 'user' &&
              harness.owner.user_id === userId()
            ) &&
            (harness.access === 'none' || harness.access === 'read')
        )
      : []
  );
  return () => pendingRuntimeRequests(owned(), teammates());
}

/** How many requests wait on the viewer's machines, for the Machines badge. */
export function useIncomingRuntimeRequestCount() {
  const owned = useOwnedMachineRequests();
  return () => incomingRequestCount(owned());
}
