import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import {
  invalidateHarnesses,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import {
  type ComputerSize,
  type ComputerStatus,
  type ComputerStatusKind,
  computersClient,
  type PurchaseComputerRequest,
  type SizeOffer,
} from '@service-auth/computers';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { createEffect, on } from 'solid-js';
import { computerKeys } from './keys';

const TRANSITION_POLL_MS = 3_000;

const TRANSITIONAL_STATUSES: readonly ComputerStatusKind[] = [
  'purchasing',
  'setting_up',
  'waiting_for_capacity',
  'starting',
  'stopping',
];

/** Polls only while a computer is moving between states. */
function computersPollInterval(
  computers: readonly ComputerStatus[] | undefined
): number | false {
  const moving = computers?.some((computer) =>
    TRANSITIONAL_STATUSES.includes(computer.status)
  );
  return moving ? TRANSITION_POLL_MS : false;
}

// Cached callbacks outlive the hooks; keep hook scope out of these closures.
function computersQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: computerKeys.list.queryKey,
    enabled,
    queryFn: () => throwOnErr(computersClient.list),
    reconcile: 'id',
    refetchOnWindowFocus: 'always',
    refetchInterval: (query) =>
      thrownResultErrorHasCode(query.state.error, 'UNAUTHORIZED')
        ? false
        : computersPollInterval(query.state.data),
  });
}

/**
 * Which computers' runtimes are connected, as one comparable string. The
 * harness list already polls presence, so a change there is the cue that a
 * computer started, stopped or dropped off.
 */
export function computerPresenceKey(
  computers: readonly ComputerStatus[] | undefined,
  connectedHarnessIds: ReadonlySet<string>
): string {
  return (computers ?? [])
    .map(
      (computer) =>
        `${computer.id}:${computer.harnessId && connectedHarnessIds.has(computer.harnessId) ? 'on' : 'off'}`
    )
    .join(',');
}

/** The current team's Macro computers; any team member can read them. */
export function useComputersQuery(enabled: () => boolean) {
  const computers = useQuery(() => computersQueryOptions(enabled()));
  const harnesses = useHarnessesQuery();
  createEffect(
    on(
      () =>
        computerPresenceKey(
          computers.data,
          new Set(
            (harnesses.data ?? [])
              .filter((harness) => harness.connected)
              .map((harness) => harness.id)
          )
        ),
      () => {
        if (enabled()) {
          fireAndForget(
            queryClient.invalidateQueries({
              queryKey: computerKeys.list.queryKey,
            }),
            'computers-presence'
          );
        }
      },
      { defer: true }
    )
  );
  return computers;
}

function computerOffersQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: computerKeys.offers.queryKey,
    enabled,
    queryFn: () => throwOnErr(computersClient.offers),
  });
}

/** Sizes the team can buy, with their price and availability. */
export function useComputerOffersQuery(enabled: () => boolean) {
  return useQuery(() => computerOffersQueryOptions(enabled()));
}

function storeComputer(updated: ComputerStatus) {
  queryClient.setQueryData<ComputerStatus[]>(
    computerKeys.list.queryKey,
    (current = []) =>
      current.map((computer) =>
        computer.id === updated.id ? updated : computer
      )
  );
}

async function purchaseComputer(request: PurchaseComputerRequest) {
  return await Telemetry.span('computers.purchase', async (span) => {
    span.setAttr('computer.size', request.size);
    try {
      const purchased = await throwOnErr(() =>
        computersClient.purchase(request)
      );
      span.setAttr('computer.id', purchased.computerId);
      span.setAttr('computer.purchase_state', purchased.state);
      return purchased;
    } catch (error) {
      span.error('Computer purchase failed');
      throw error;
    }
  });
}

export function usePurchaseComputerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: purchaseComputer,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: computerKeys.list.queryKey }),
        queryClient.invalidateQueries({
          queryKey: computerKeys.offers.queryKey,
        }),
      ]);
    },
  }));
}

export function useNotifyComputerSizeMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (size: ComputerSize) =>
      throwOnErr(() => computersClient.notify(size)),
    onSuccess: (_data, size) => {
      queryClient.setQueryData<SizeOffer[]>(
        computerKeys.offers.queryKey,
        (current = []) =>
          current.map((offer) =>
            offer.size === size ? { ...offer, notifyRequested: true } : offer
          )
      );
    },
  }));
}

export function useSetComputerPowerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (vars: { computerId: string; on: boolean }) =>
      throwOnErr(() => computersClient.setPower(vars.computerId, vars.on)),
    onSuccess: storeComputer,
  }));
}

export function useCancelComputerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (computerId: string) =>
      throwOnErr(() => computersClient.cancel(computerId)),
    onSuccess: storeComputer,
  }));
}

export function useUndoCancelComputerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (computerId: string) =>
      throwOnErr(() => computersClient.undoCancel(computerId)),
    onSuccess: storeComputer,
  }));
}

/** Bills a released computer again while its disk is still retained. */
export function useRestoreComputerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (computerId: string) =>
      throwOnErr(() => computersClient.restore(computerId)),
    onSuccess: storeComputer,
  }));
}

export function useReleaseComputerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (vars: { computerId: string; confirmName: string }) =>
      throwOnErr(() =>
        computersClient.release(vars.computerId, vars.confirmName)
      ),
    onSuccess: async (released) => {
      storeComputer(released);
      await invalidateHarnesses();
    },
  }));
}

/** Marks guided setup finished, so the card stops offering Finish setup. */
export function useCompleteComputerSetupMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (computerId: string) =>
      throwOnErr(() => computersClient.completeSetup(computerId)),
    onSuccess: storeComputer,
  }));
}
