import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import {
  routineWebhookUrl,
  scheduledActionClient,
} from '@service-scheduled-action/client';
import type {
  CreatedRoutineWebhook,
  RoutineWebhook,
} from '@service-scheduled-action/generated/schemas';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, createSignal } from 'solid-js';
import { scheduledActionKeys } from './keys';

/** A routine without a URL has none: `null`, not an error. */
async function fetchWebhook(
  scheduleId: string
): Promise<RoutineWebhook | null> {
  const result = await scheduledActionClient.getWebhook(scheduleId);
  if (
    result.isErr() &&
    result.error.some((error) => error.code === 'NOT_FOUND')
  )
    return null;
  return throwOnErr(async () => result);
}

export function routineWebhookQueryOptions(
  scheduleId: string | undefined,
  enabled = true
) {
  return queryOptions({
    queryKey: scheduledActionKeys.webhook({
      scheduleId: scheduleId ?? '__none__',
    }).queryKey,
    enabled: enabled && Boolean(scheduleId),
    queryFn: () => fetchWebhook(scheduleId!),
  });
}

function setWebhook(scheduleId: string, webhook: RoutineWebhook | null) {
  queryClient.setQueryData(
    scheduledActionKeys.webhook({ scheduleId }).queryKey,
    webhook
  );
}

async function createWebhook(scheduleId: string) {
  return Telemetry.span('routine.webhook.create', async (span) => {
    span.setAttr('routine.id', scheduleId);
    const created = await throwOnErr(() =>
      scheduledActionClient.createWebhook(scheduleId)
    );
    setWebhook(scheduleId, created.webhook);
    return created;
  });
}

async function deleteWebhook(scheduleId: string) {
  return Telemetry.span('routine.webhook.delete', async (span) => {
    span.setAttr('routine.id', scheduleId);
    await throwOnErr(() => scheduledActionClient.deleteWebhook(scheduleId));
    setWebhook(scheduleId, null);
  });
}

export type RoutineWebhookState = {
  /** Undefined while loading or before the routine is saved; null without a URL. */
  webhook: RoutineWebhook | null | undefined;
  /** The full URL just made, shown only until the panel closes. */
  createdUrl: string | undefined;
  failed: boolean;
  pending: boolean;
  create: () => void;
  remove: () => void;
};

/**
 * A saved routine's webhook URL and how to make, replace or delete it. Its
 * token is shown only when it is made; afterwards only its prefix is known.
 */
export function createRoutineWebhook(
  scheduleId: Accessor<string | undefined>,
  enabled: Accessor<boolean>
): Accessor<RoutineWebhookState> {
  const query = useQuery(() =>
    routineWebhookQueryOptions(scheduleId(), enabled())
  );
  const [created, setCreated] = createSignal<CreatedRoutineWebhook>();
  const create = useMutation(() => ({ mutationFn: createWebhook }));
  const remove = useMutation(() => ({ mutationFn: deleteWebhook }));
  return () => {
    const id = scheduleId();
    const fresh = created();
    return {
      webhook: query.isSuccess ? query.data : undefined,
      createdUrl:
        fresh && fresh.webhook.routineId === id
          ? routineWebhookUrl(fresh.token)
          : undefined,
      failed: query.isError || create.isError || remove.isError,
      pending: create.isPending || remove.isPending,
      create: () => {
        if (id) create.mutate(id, { onSuccess: setCreated });
      },
      remove: () => {
        if (id) remove.mutate(id, { onSuccess: () => setCreated(undefined) });
      },
    };
  };
}
