import { throwOnErr } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type {
  MintedWebhookResponse,
  WebhookInfo,
} from '@service-scheduled-action/generated/schemas';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { RoutineWebhookState } from '../core/webhook';
import { scheduledActionKeys } from './keys';

type Minted = MintedWebhookResponse & { scheduleId: string };

/** The routine's URL without its secret; `null` when it has none. */
async function fetchWebhook(scheduleId: string): Promise<WebhookInfo | null> {
  const status = await throwOnErr(() =>
    scheduledActionClient.getWebhook(scheduleId)
  );
  return status.webhook ?? null;
}

export function routineWebhookQueryOptions(
  scheduleId: string | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: scheduledActionKeys.webhook({
      scheduleId: scheduleId ?? '__none__',
    }).queryKey,
    enabled: enabled && Boolean(scheduleId),
    queryFn: () => fetchWebhook(scheduleId!),
  });
}

/** A read still in flight began before this write, so it is cancelled first. */
async function setWebhook(scheduleId: string, webhook: WebhookInfo | null) {
  const { queryKey } = scheduledActionKeys.webhook({ scheduleId });
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData(queryKey, webhook);
}

async function mintWebhook(scheduleId: string): Promise<Minted> {
  return Telemetry.span('routine.webhook.create', async (span) => {
    span.setAttr('routine.id', scheduleId);
    const minted = await throwOnErr(() =>
      scheduledActionClient.mintWebhook(scheduleId)
    );
    span.setAttr('routine.webhook.hook_id', minted.hookId);
    await setWebhook(scheduleId, {
      hookId: minted.hookId,
      createdAt: minted.createdAt,
    });
    return { ...minted, scheduleId };
  });
}

async function removeWebhook(scheduleId: string) {
  return Telemetry.span('routine.webhook.delete', async (span) => {
    span.setAttr('routine.id', scheduleId);
    await throwOnErr(() => scheduledActionClient.removeWebhook(scheduleId));
    await setWebhook(scheduleId, null);
  });
}

/**
 * A saved routine's webhook URL and how to make, replace or delete it. Its
 * secret is known only in the response that made it; afterwards the panel
 * shows when it was made and last used. It loads while a panel showing it is
 * mounted.
 */
export function createRoutineWebhook(
  scheduleId: Accessor<string | undefined>
): Accessor<RoutineWebhookState> {
  const [panels, setPanels] = createSignal(0);
  const query = useQuery(() =>
    routineWebhookQueryOptions(scheduleId(), panels() > 0)
  );
  // The secret lives only here, while a panel shows it: closing the last
  // panel forgets it, a mint answered after that is dropped (`closed` counts
  // the times the last panel closed), and the mutation keeps no copy
  // (`gcTime: 0`, reset).
  const [minted, setMinted] = createSignal<Minted>();
  let closed = 0;
  const create = useMutation(() => ({ mutationFn: mintWebhook, gcTime: 0 }));
  const remove = useMutation(() => ({ mutationFn: removeWebhook }));
  return () => {
    const id = scheduleId();
    const fresh = minted();
    return {
      webhook: query.isPending ? undefined : query.data,
      created:
        fresh && fresh.scheduleId === id
          ? { url: fresh.url, bearerUrl: fresh.bearerUrl, secret: fresh.secret }
          : undefined,
      failed: query.isError || create.isError || remove.isError,
      pending: create.isPending || remove.isPending,
      load: () => {
        setPanels((count) => count + 1);
        onCleanup(() => {
          if (setPanels((count) => count - 1) > 0) return;
          closed += 1;
          setMinted(undefined);
        });
      },
      create: () => {
        if (!id) return;
        const asked = closed;
        create.mutate(id, {
          onSuccess: (fresh) => {
            if (asked === closed) setMinted(fresh);
            create.reset();
          },
        });
      },
      remove: () => {
        if (id) remove.mutate(id, { onSuccess: () => setMinted(undefined) });
      },
    };
  };
}
