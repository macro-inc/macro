import { throwOnErr } from '@core/util/result';
import { invalidateAgents } from '@queries/agents/agents';
import { queryClient } from '@queries/client';
import {
  type Harness,
  type HarnessPairing,
  storageServiceClient,
} from '@service-storage/client';
import { useMutation, useQuery } from '@tanstack/solid-query';
import { harnessKeys } from './keys';

export type ApproveHarnessPairingParams = {
  code: string;
  name?: string;
  teamId?: string;
};

export type DeleteHarnessParams = {
  harnessId: string;
};

/**
 * The macrod harnesses registered for the signed-in user (and their team).
 * Refetched on a short interval so the connected indicator tracks the daemon
 * heartbeat without a manual refresh.
 */
export function useHarnessesQuery() {
  return useQuery(() => ({
    queryKey: harnessKeys.list.queryKey,
    queryFn: async (): Promise<Harness[]> =>
      await throwOnErr(() => storageServiceClient.getHarnesses()),
    refetchInterval: 15_000,
  }));
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
  return useQuery(() => ({
    queryKey: harnessKeys.pairing(code() ?? '').queryKey,
    queryFn: async (): Promise<HarnessPairing> =>
      await throwOnErr(() =>
        storageServiceClient.getHarnessPairing({ code: code() ?? '' })
      ),
    enabled: (code() ?? '').length > 0,
    retry: false,
  }));
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
