import type { TeamAgentComputer } from '@service-auth/generated/schemas';
import type { Harness } from '@service-storage/client';
import type {
  AccessLevel,
  AccessRequestState,
  ShareEntity,
} from '@service-storage/generated/schemas';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';

export const harnessId = '11111111-1111-4111-8111-111111111111';
const params = new URLSearchParams(location.search);
const initialRole = match(params.get('access'))
  .with('none', () => 'none' as const)
  .with('read', () => 'read' as const)
  .with('resident', () => 'resident' as const)
  .with('user', () => 'user' as const)
  .with('owner', () => 'owner' as const)
  .otherwise(() => 'read' as const);
export const [role, setRole] = createSignal(initialRole);
// The scripted service can publish a role change while Settings is covered.
window.addEventListener('fixture:revoke-control', () => setRole('read'));
export const [lookups, setLookups] = createSignal(0);
export const [directoryLoads, setDirectoryLoads] = createSignal(0);
export const [connections, setConnections] = createSignal<string[]>([]);
export const [requests, setRequests] = createSignal<AccessLevel[]>([]);
export const agentComputer = !params.has('ordinary');
const [directoryFailed, setDirectoryFailed] = createSignal(
  params.has('directory-error')
);
let directoryServiceHealthy = !params.has('directory-error');
let finishLookup: (() => void) | undefined;

const harness = (): Harness => ({
  id: harnessId,
  name: 'Fictional teammate computer',
  kind: 'macrod',
  connected: true,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  created_by: 'fixture-owner',
  owner: { type: 'user', user_id: 'fixture-owner' },
  access: role(),
  is_agent_computer: agentComputer,
});

export function useHarnessDirectoryQuery() {
  setDirectoryLoads((count) => count + 1);
  return {
    get isSuccess() {
      return !directoryFailed();
    },
    get isError() {
      return directoryFailed();
    },
    isPending: false,
    get data() {
      return directoryFailed() ? undefined : [harness()];
    },
    refetch: async () => {
      setDirectoryLoads((count) => count + 1);
      setDirectoryFailed(!directoryServiceHealthy);
      return { data: directoryFailed() ? undefined : [harness()] };
    },
  };
}

export function useTeamAgentComputerMutation() {
  return {
    mutateAsync: async (): Promise<TeamAgentComputer> => {
      setLookups((count) => count + 1);
      if (params.has('lookup-error'))
        throw new Error('Scripted discovery failure');
      if (params.has('slow-discovery')) {
        await new Promise<void>((resolve) => {
          finishLookup = resolve;
        });
      }
      return {
        computerId: 'fixture-computer',
        harnessId: params.has('unpaired') ? null : harnessId,
        isAgentComputer: agentComputer,
      };
    },
  };
}

export function completeLookup() {
  finishLookup?.();
}

export function restoreDirectoryService() {
  directoryServiceHealthy = true;
}

const [requestState, setRequestState] = createSignal<AccessRequestState>({
  accessLevel: null,
  canReview: false,
  supportedLevels: agentComputer ? ['view'] : ['view', 'edit'],
  mine: null,
  requests: [],
  pendingCount: 0,
});

export function useAccessRequestState() {
  return {
    isPending: false,
    isFetching: false,
    isPaused: false,
    isFetchedAfterMount: true,
    isError: false,
    get data() {
      return requestState();
    },
    refetch: async () => ({ data: requestState(), error: null }),
  };
}

export const accessRequestsClient = {
  grants: () => okAsync([]),
  submit: (_entity: ShareEntity, level: AccessLevel) => {
    setRequests((previous) => [...previous, level]);
    const mine = {
      id: 'fixture-request',
      requesterId: 'fixture-viewer',
      requestedLevel: level,
      status: 'pending' as const,
      revision: 1,
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    };
    setRequestState((previous) => ({ ...previous, mine }));
    return okAsync(mine);
  },
  cancel: () => okAsync({}),
  resolve: () => okAsync({}),
  setGrant: () => okAsync({}),
};
export async function invalidateAccessRequests() {}
export function refreshSharedAccess() {}

export function useTeamAgentComputerQuery() {
  return { isPending: false, data: undefined };
}
