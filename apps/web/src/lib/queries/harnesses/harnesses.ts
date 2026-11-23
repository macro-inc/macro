import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import {
  accessRequestsClient,
  fetchAccessRequestState,
  refreshSharedAccess,
} from '@queries/access-requests/requests';
import { invalidateAgents } from '@queries/agents/agents';
import { queryClient } from '@queries/client';
import {
  type Harness,
  type HarnessPairing,
  type HarnessResident,
  storageServiceClient,
} from '@service-storage/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { harnessKeys } from './keys';
import { runnableHarnesses } from './runnable';

export type ApproveHarnessPairingParams = {
  allowPermissionBypass?: boolean;
  code: string;
  name?: string;
  teamId?: string;
};

export type PatchHarnessParams = {
  harnessId: string;
  name?: string;
  allowPermissionBypass?: boolean;
};

export type DeleteHarnessParams = {
  harnessId: string;
};

// Cached callbacks outlive the hooks; keep hook scope out of these closures.
const harnessesQueryOptions = queryOptions({
  queryKey: harnessKeys.list.queryKey,
  queryFn: async (): Promise<Harness[]> =>
    await throwOnErr(() => storageServiceClient.getHarnesses()),
  // A dead session answers every poll with a 401, so wait for the next
  // successful fetch (login invalidates every query) before polling again.
  refetchInterval: (query) =>
    thrownResultErrorHasCode(query.state.error, 'UNAUTHORIZED')
      ? false
      : 15_000,
});

/**
 * The macrod harnesses registered for the signed-in user (and their team).
 * Refetched on a short interval so the connected indicator tracks the daemon
 * heartbeat without a manual refresh.
 */
export function useHarnessesQuery() {
  return useQuery(() => harnessesQueryOptions);
}

/**
 * The same list without agent teammates' computers: for everything that
 * starts an agent or binds one to a runtime. Their agent is reached by
 * message instead.
 */
export function useRunnableHarnessesQuery() {
  return useQuery(() => ({
    ...harnessesQueryOptions,
    select: runnableHarnesses,
  }));
}

/** The same list, for code outside components; fresh data is reused. */
export function fetchHarnesses(): Promise<Harness[]> {
  return queryClient.fetchQuery(harnessesQueryOptions);
}

const harnessDirectoryQueryOptions = queryOptions({
  queryKey: harnessKeys.directory.queryKey,
  queryFn: async (): Promise<Harness[]> =>
    await throwOnErr(() => storageServiceClient.getHarnessDirectory()),
  staleTime: 15_000,
  reconcile: 'id',
  throwOnError: false,
});

/** Every runtime of the viewer's teammates, usable by the viewer or not. */
export function useHarnessDirectoryQuery(
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => ({
    ...harnessDirectoryQueryOptions,
    enabled: enabled(),
  }));
}

/** The directory without agent teammates' computers, which run only their agent. */
export function useRunnableHarnessDirectoryQuery(
  enabled: Accessor<boolean> = () => true
) {
  return useQuery(() => ({
    ...harnessDirectoryQueryOptions,
    enabled: enabled(),
    select: runnableHarnesses,
  }));
}

function harnessResidentsQueryOptions(harnessId: string, enabled: boolean) {
  return queryOptions({
    queryKey: harnessKeys.residents(harnessId).queryKey,
    queryFn: async (): Promise<HarnessResident[]> =>
      await throwOnErr(() =>
        storageServiceClient.getHarnessResidents({ harness_id: harnessId })
      ),
    enabled,
    throwOnError: false,
  });
}

/** The agents living on a runtime the viewer may use. */
export function useHarnessResidentsQuery(
  harnessId: () => string,
  enabled: () => boolean
) {
  return useQuery(() => harnessResidentsQueryOptions(harnessId(), enabled()));
}

/** Both views of who may use which runtime, after that changes. */
export function invalidateHarnesses() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: harnessKeys.list.queryKey }),
    queryClient.invalidateQueries({ queryKey: harnessKeys.directory.queryKey }),
  ]);
}

/** A new request for User access, or the one that was already waiting. */
export type HarnessAccessRequestOutcome = 'sent' | 'already_requested';

/**
 * Ask a runtime's owner for User access, superseding an earlier request for
 * less. A person deciding to request is an explicit act; nothing calls this on
 * its own.
 */
export async function requestHarnessAccess(
  harnessId: string
): Promise<HarnessAccessRequestOutcome> {
  const entity = { entityType: 'harness', entityId: harnessId } as const;
  const state = await fetchAccessRequestState(entity);
  const mine = state.mine;
  if (mine?.status === 'pending' && mine.requestedLevel === 'edit') {
    return 'already_requested';
  }
  await throwOnErr(() =>
    accessRequestsClient.submit(entity, 'edit', mine?.revision)
  );
  refreshSharedAccess(entity);
  return 'sent';
}

export type SetHarnessTeamAccessParams = {
  harnessId: string;
  teamId: string;
  enabled: boolean;
};

export function useSetHarnessTeamAccessMutation() {
  return useMutation(() => ({
    mutationFn: async (vars: SetHarnessTeamAccessParams) =>
      await throwOnErr(() =>
        storageServiceClient.setHarnessTeamAccess({
          harness_id: vars.harnessId,
          team_id: vars.teamId,
          enabled: vars.enabled,
        })
      ),
    onSuccess: () => invalidateHarnesses(),
  }));
}

/**
 * Looks up a pending pairing request by its printed code. Disabled until a
 * code is committed, and never retried: a 404/410 is an answer (invalid or
 * expired code), not a transient failure.
 */
export function useHarnessPairingQuery(code: () => string | undefined) {
  return useQuery(() => harnessPairingQueryOptions(code() ?? ''));
}

function harnessPairingQueryOptions(code: string) {
  return queryOptions({
    queryKey: harnessKeys.pairing(code).queryKey,
    queryFn: async (): Promise<HarnessPairing> =>
      await throwOnErr(() => storageServiceClient.getHarnessPairing({ code })),
    enabled: code.length > 0,
    retry: false,
  });
}

export function useApproveHarnessPairingMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: ApproveHarnessPairingParams) =>
      await throwOnErr(() =>
        storageServiceClient.approveHarnessPairing({
          code: vars.code,
          name: vars.name,
          team_id: vars.teamId,
          allow_permission_bypass: vars.allowPermissionBypass ?? false,
        })
      ),
    onSuccess: async (_harness, vars) => {
      queryClient.removeQueries({
        queryKey: harnessKeys.pairing(vars.code).queryKey,
      });
      await invalidateHarnesses();
    },
    onError: (error) =>
      console.error('failed to approve harness pairing', error),
  }));
}

/**
 * Approves a pairing opened by this computer's own daemon, granting exactly
 * the permission-bypass ceiling the daemon requested from its config, so a
 * re-pair keeps the access the user chose at setup.
 */
export function useApproveOwnHarnessPairingMutation() {
  return useMutation(() => ({
    gcTime: 0,
    // Approved as a private runtime that prompts; setup turns bypass on
    // through the runtime's web setting when the user chose Full access in setup.
    mutationFn: async (code: string) =>
      await throwOnErr(() =>
        storageServiceClient.approveHarnessPairing({
          code,
          allow_permission_bypass: false,
        })
      ),
    onSuccess: async () => await invalidateHarnesses(),
    onError: (error) =>
      console.error('failed to approve local harness pairing', error),
  }));
}

export async function patchHarness(vars: PatchHarnessParams) {
  const updated = await throwOnErr(() =>
    storageServiceClient.patchHarness({
      harness_id: vars.harnessId,
      name: vars.name,
      allow_permission_bypass: vars.allowPermissionBypass,
    })
  );
  queryClient.setQueryData<Harness[]>(harnessKeys.list.queryKey, (current) =>
    current?.map((harness) => (harness.id === updated.id ? updated : harness))
  );
  return updated;
}

export function usePatchHarnessMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: patchHarness,
    onError: (error) => console.error('failed to change harness', error),
  }));
}

export function useDeleteHarnessMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: DeleteHarnessParams) =>
      await throwOnErr(() =>
        storageServiceClient.deleteHarness({ harness_id: vars.harnessId })
      ),
    onSuccess: async (_data, vars) => {
      queryClient.setQueryData<Harness[]>(
        harnessKeys.list.queryKey,
        (current = []) =>
          current.filter((harness) => harness.id !== vars.harnessId)
      );
      // Agents bound to the removed harness now resolve to "Disconnected
      // harness"; refresh them so the agents surface reflects that.
      await invalidateAgents();
    },
    onError: (error) => console.error('failed to delete harness', error),
  }));
}
