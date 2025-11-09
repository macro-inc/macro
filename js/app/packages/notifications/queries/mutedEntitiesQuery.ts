import { isErr } from '@core/util/maybeResult';
import { notificationServiceClient } from '@service-notification/client';
import { useQuery } from '@tanstack/solid-query';

const fetchUnsubscriptions = async () => {
  const response = await notificationServiceClient.getUnsubscribes();

  if (isErr(response))
    throw new Error('Failed to fetch unsubscribers', { cause: response });

  const result = response[1].data;
  return result;
};

export function createMutedEntitiesQuery(args?: { limit?: number }) {
  const limit =
    args?.limit && args.limit > 0 && args.limit <= 500 ? args.limit : 20;

  return useQuery(() => ({
    queryKey: ['unsubscribers', { infinite: true }],
    queryFn: () => fetchUnsubscriptions(),
    initialPageParam: { limit },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
  }));
}
