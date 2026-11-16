/**
 * The platform status banner: the current status every user sees, kept live
 * by `system_status` websocket broadcasts, plus the staff dashboard's history
 * and setter.
 */
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/result';
import { authServiceClient } from '@service-auth/client';
import type { CurrentSystemStatus } from '@service-auth/generated/schemas/currentSystemStatus';
import type { StatusUpdate } from '@service-auth/generated/schemas/statusUpdate';
import type { SystemStatus } from '@service-auth/generated/schemas/systemStatus';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { z } from 'zod';
import { queryClient } from '../client';
import { systemStatusKeys } from './keys';

export type { CurrentSystemStatus, StatusUpdate, SystemStatus };

export const SYSTEM_STATUS_MESSAGE_TYPE = 'system_status';

// Broadcasts keep open apps current; the interval only covers a missed one.
const STATUS_REFETCH_INTERVAL_MS = 5 * 60_000;

const idSchema = z.string().nullish();
const updatedAtSchema = z.string().nullish();
const currentSystemStatusSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('operational'),
    id: idSchema,
    updatedAt: updatedAtSchema,
  }),
  z.object({
    status: z.literal('degraded'),
    message: z.string(),
    id: idSchema,
    updatedAt: updatedAtSchema,
  }),
  z.object({
    status: z.literal('major_outage'),
    message: z.string(),
    id: idSchema,
    updatedAt: updatedAtSchema,
  }),
]);

const jsonStringSchema = z.string().transform((value, ctx) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'invalid JSON' });
    return z.NEVER;
  }
});

const systemStatusPayloadSchema = z.union([
  currentSystemStatusSchema,
  jsonStringSchema.pipe(currentSystemStatusSchema),
]);

function updatedAtMs(status: CurrentSystemStatus | undefined): number {
  return status?.updatedAt ? Date.parse(status.updatedAt) : 0;
}

/**
 * Keeps whichever of the cached and incoming status was set last, so a fetch
 * that started before a broadcast can't put an older status back.
 */
function keepNewest(
  incoming: CurrentSystemStatus,
  cached: CurrentSystemStatus | undefined
): CurrentSystemStatus {
  return cached && updatedAtMs(cached) > updatedAtMs(incoming)
    ? cached
    : incoming;
}

export function currentSystemStatusQueryOptions() {
  return queryOptions({
    queryKey: systemStatusKeys.current.queryKey,
    queryFn: async () => {
      const fetched = await throwOnErr(() =>
        authServiceClient.getSystemStatus()
      );
      return keepNewest(
        fetched,
        queryClient.getQueryData<CurrentSystemStatus>(
          systemStatusKeys.current.queryKey
        )
      );
    },
    refetchInterval: STATUS_REFETCH_INTERVAL_MS,
  });
}

/** The status every user sees. */
export function useCurrentSystemStatusQuery() {
  return useQuery(() => currentSystemStatusQueryOptions());
}

/** Applies a `system_status` websocket broadcast. */
export function handleSystemStatusMessage(payload: unknown) {
  const result = systemStatusPayloadSchema.safeParse(payload);
  if (!result.success) {
    console.warn('Malformed system status payload', payload);
    return;
  }
  queryClient.setQueryData<CurrentSystemStatus>(
    systemStatusKeys.current.queryKey,
    (cached) => keepNewest(result.data, cached)
  );
  queryClient.invalidateQueries({
    queryKey: systemStatusKeys.history.queryKey,
  });
}

/** Catches up on a broadcast missed while the websocket was down. */
export function invalidateCurrentSystemStatus() {
  queryClient.invalidateQueries({
    queryKey: systemStatusKeys.current.queryKey,
  });
}

function systemStatusHistoryQueryOptions() {
  return queryOptions({
    queryKey: systemStatusKeys.history.queryKey,
    queryFn: async () =>
      await throwOnErr(() => authServiceClient.listSystemStatusHistory()),
  });
}

/** Staff dashboard: recent updates, newest first. */
export function useSystemStatusHistoryQuery() {
  return useQuery(() => systemStatusHistoryQueryOptions());
}

export function useSetSystemStatusMutation() {
  return useMutation(() => ({
    mutationFn: async (status: SystemStatus) =>
      await throwOnErr(() => authServiceClient.setSystemStatus(status)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: systemStatusKeys._def });
      toast.success('Status updated');
    },
    onError: (error: Error) => {
      toast.failure(error.message || "Couldn't update the status");
    },
  }));
}
