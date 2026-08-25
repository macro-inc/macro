import { notificationServiceClient } from '@service-notification/client';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import { useQuery } from '@tanstack/solid-query';
import { createSignal, onMount } from 'solid-js';

const EMPTY_MUTED_ENTITIES: UserUnsubscribe[] = [];

const fetchUnsubscriptions = async () => {
  const response = await notificationServiceClient.getUnsubscribes();

  if (response.isErr())
    throw new Error('Failed to fetch unsubscribers', { cause: response });

  const result = response.value.data;
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
    placeholderData: (previous) => previous ?? EMPTY_MUTED_ENTITIES,
  }));
}

/** Settings-page list. Avoids Solid Query so unmute cannot remount the tab. */
export function createMutedEntities() {
  const [data, setData] = createSignal<UserUnsubscribe[]>([]);

  onMount(() => {
    void fetchUnsubscriptions()
      .then(setData)
      .catch(() => setData([]));
  });

  const unmute = async (item: UserUnsubscribe) => {
    const result = await notificationServiceClient.removeUnsubscribeItem(item);
    if (result.isErr()) return result;
    setData((current) =>
      current.filter(
        (row) =>
          !(row.item_id === item.item_id && row.item_type === item.item_type)
      )
    );
    return result;
  };

  return { data, unmute };
}
