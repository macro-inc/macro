import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { invalidateAgents } from '@queries/agents/agents';
import { queryClient } from '@queries/client';
import {
  type Harness,
  type HarnessPairing,
  storageServiceClient,
} from '@service-storage/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { harnessKeys } from './keys';

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

export function invalidateHarnesses() {
  return queryClient.invalidateQueries({
    queryKey: harnessKeys.list.queryKey,
  });
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
    // through the runtime's web setting when the user chose Full Access.
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
