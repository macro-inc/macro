import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode, throwOnErr } from '@core/util/result';
import { type Span, Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import {
  invalidateHarnesses,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import { harnessKeys } from '@queries/harnesses/keys';
import {
  BILLING_PROVIDER_FAILED,
  COMPUTERS_UNAVAILABLE,
  type ComputerStatus,
  type ComputerStatusKind,
  computersClient,
  type PurchaseComputerRequest,
} from '@service-auth/computers';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { createEffect, on } from 'solid-js';
import { computerKeys } from './keys';

const TRANSITION_POLL_MS = 3_000;
/**
 * How often a ready or failed computer is checked again: the server marks it
 * unhealthy, or recovers it, minutes after any presence change this client
 * sees.
 */
const SETTLED_POLL_MS = 30_000;

const TRANSITIONAL_STATUSES: readonly ComputerStatusKind[] = [
  'purchasing',
  'setting_up',
  'waiting_for_capacity',
  'starting',
  'stopping',
  'unhealthy',
];

const SETTLED_LIVE_STATUSES: readonly ComputerStatusKind[] = [
  'ready',
  'failed',
];

/** Polls fast while a computer is moving between states, slowly while one may change on its own. */
export function computersPollInterval(
  computers: readonly ComputerStatus[] | undefined
): number | false {
  const has = (statuses: readonly ComputerStatusKind[]) =>
    computers?.some((computer) => statuses.includes(computer.status));
  if (has(TRANSITIONAL_STATUSES)) return TRANSITION_POLL_MS;
  return has(SETTLED_LIVE_STATUSES) ? SETTLED_POLL_MS : false;
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

/**
 * Each computer's lifecycle status, as one comparable string. A change is the
 * cue to refresh the runtime directory, which shows computers' power state
 * elsewhere and does not poll on its own.
 */
export function computerStatusKey(
  computers: readonly ComputerStatus[] | undefined
): string {
  return (computers ?? [])
    .map((computer) => `${computer.id}:${computer.status}`)
    .join(',');
}

/**
 * The last presence and status keys acted on, shared by every
 * `useComputersQuery` caller, so one change refreshes once however many
 * callers are mounted. Module-level on purpose: two components (on Settings →
 * Agents) each run the query, and keys kept per hook would invalidate twice.
 */
const handledKeys = { presence: '', status: '' };

/** Runs `refresh` when `key` changes, once across every caller. */
function refreshOnChange(
  kind: keyof typeof handledKeys,
  key: () => string,
  refresh: () => void
) {
  createEffect(
    on(
      key,
      (next) => {
        if (next === handledKeys[kind]) return;
        handledKeys[kind] = next;
        refresh();
      },
      { defer: true }
    )
  );
}

/** The current team's Macro computers; any team member can read them. */
/**
 * The team's computers read now, past the cache's freshness, for a caller
 * waiting on one of them; the list query shows the same answer.
 */
export async function fetchComputers(): Promise<ComputerStatus[]> {
  return await queryClient.fetchQuery({
    ...computersQueryOptions(true),
    staleTime: 0,
  });
}

export function useComputersQuery(enabled: () => boolean) {
  const computers = useQuery(() => computersQueryOptions(enabled()));
  const harnesses = useHarnessesQuery();
  const invalidate = (queryKey: readonly unknown[], name: string) => {
    if (!enabled()) return;
    fireAndForget(queryClient.invalidateQueries({ queryKey }), name);
  };
  refreshOnChange(
    'presence',
    () =>
      computerPresenceKey(
        computers.data,
        new Set(
          (harnesses.data ?? [])
            .filter((harness) => harness.connected)
            .map((harness) => harness.id)
        )
      ),
    () => invalidate(computerKeys.list.queryKey, 'computers-presence')
  );
  refreshOnChange(
    'status',
    () => computerStatusKey(computers.data),
    () => invalidate(harnessKeys.directory.queryKey, 'computers-directory')
  );
  return computers;
}

/** Failures a second request may get past: the server or the network. */
const RETRYABLE_OFFERS_FAILURES: readonly string[] = [
  'SERVER_ERROR',
  COMPUTERS_UNAVAILABLE,
  BILLING_PROVIDER_FAILED,
  'NETWORK_ERROR',
];

/**
 * Whether to ask for the sizes again: once after a 5xx or a dropped
 * connection, never after a refusal the server will repeat (a trial, no paid
 * plan, no rollout, any other 4xx), and never after a timeout, which has
 * already cost the client's whole request deadline; the user gets Retry.
 */
export function retryComputerOffers(failures: number, error: unknown): boolean {
  return (
    failures < 1 &&
    RETRYABLE_OFFERS_FAILURES.some((code) =>
      thrownResultErrorHasCode(error, code)
    )
  );
}

/** New points arrive once a minute. */
const USAGE_POLL_MS = 60_000;

// Cached callbacks outlive the hooks; keep hook scope out of these closures.
function computerUsageQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: computerKeys.usage.queryKey,
    enabled,
    queryFn: () => throwOnErr(computersClient.usage),
    reconcile: 'computerId',
    refetchInterval: USAGE_POLL_MS,
  });
}

/** Each of the team's computers' CPU and memory over the last day. */
export function useComputerUsageQuery(enabled: () => boolean) {
  return useQuery(() => computerUsageQueryOptions(enabled()));
}

const ROLLOUT_STALE_MS = 5 * 60_000;

function computerRolloutQueryOptions() {
  return queryOptions({
    queryKey: computerKeys.rollout.queryKey,
    queryFn: () => throwOnErr(computersClient.rollout),
    staleTime: ROLLOUT_STALE_MS,
    // A refusal (no team, signed out) means not rolled out; it won't change on retry.
    retry: false,
  });
}

type ComputersRollout = { enabled: boolean; loading: boolean };

/**
 * Whether the computer UI is on for the current user. The backend answers
 * with the same check purchases and offers make (`enable-macro-computers`,
 * plus the dev-only allowlist), so the web never shows computers the backend
 * would refuse. Any failure reads as off.
 */
export function useMacroComputersRollout(): () => ComputersRollout {
  const query = useQuery(() => computerRolloutQueryOptions());
  return () => ({
    enabled: query.isSuccess && query.data.enabled,
    loading: query.isPending,
  });
}

function computerOffersQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: computerKeys.offers.queryKey,
    enabled,
    queryFn: () => throwOnErr(computersClient.offers),
    retry: retryComputerOffers,
    // The dialog opens on a query the Runtimes row already ran; a refusal
    // shows at once rather than being asked again on every opening.
    retryOnMount: false,
  });
}

/**
 * Sizes the team can buy, with their price and availability. The Runtimes
 * row and the Agents entry run it as soon as they show the offer, so the
 * purchase dialog opens with the sizes already loaded.
 */
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

type PurchaseComputerArgs = PurchaseComputerRequest & {
  /** The Buy flow's span, so the purchase joins its trace across the await. */
  parentSpan?: Span;
};

async function purchaseComputer(args: PurchaseComputerArgs) {
  const { parentSpan, ...request } = args;
  const purchase = (span: Span) => purchaseInSpan(request, span);
  if (parentSpan) return await parentSpan.span('computers.purchase', purchase);
  return await Telemetry.span('computers.purchase', purchase);
}

async function purchaseInSpan(request: PurchaseComputerRequest, span: Span) {
  span.setAttr('computer.size', request.size);
  try {
    const purchased = await throwOnErr(() => computersClient.purchase(request));
    span.setAttr('computer.id', purchased.computerId);
    span.setAttr('computer.purchase_state', purchased.state);
    return purchased;
  } catch (error) {
    span.error('Computer purchase failed');
    throw error;
  }
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

/** Sets a failed computer up again; billing is untouched. */
export function useRetryComputerMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: (computerId: string) =>
      throwOnErr(() => computersClient.retry(computerId)),
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
