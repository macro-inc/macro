import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type { RoutineWebhook } from '@service-scheduled-action/generated/schemas';
import { queryOptions, useMutation, useQuery } from '@tanstack/solid-query';
import { scheduledActionKeys } from './keys';

function routineWebhookQueryOptions(scheduleId: string) {
  return queryOptions({
    queryKey: scheduledActionKeys.webhook({ scheduleId }).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => scheduledActionClient.getWebhook({ scheduleId })))
        .webhook,
  });
}

/** The routine's webhook URL without its secret; null when it has none. */
export function useRoutineWebhookQuery(scheduleId: () => string) {
  return useQuery(() => routineWebhookQueryOptions(scheduleId()));
}

function setWebhook(scheduleId: string, webhook: RoutineWebhook | null) {
  queryClient.setQueryData(
    scheduledActionKeys.webhook({ scheduleId }).queryKey,
    webhook
  );
}

/** Issue a token, replacing the last. The response is the only time it is shown. */
export function useIssueRoutineWebhookMutation() {
  return useMutation(() => ({
    mutationFn: (scheduleId: string) =>
      throwOnErr(() => scheduledActionClient.issueWebhook({ scheduleId })),
    onSuccess: (issued, scheduleId) =>
      setWebhook(scheduleId, {
        tokenPrefix: issued.tokenPrefix,
        createdAt: issued.createdAt,
      }),
  }));
}

export function useRevokeRoutineWebhookMutation() {
  return useMutation(() => ({
    mutationFn: (scheduleId: string) =>
      throwOnErr(() => scheduledActionClient.revokeWebhook({ scheduleId })),
    onSuccess: (_, scheduleId) => setWebhook(scheduleId, null),
  }));
}
