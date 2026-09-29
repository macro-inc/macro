import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { ListReminderOccurrencesParams } from '@service-storage/generated/schemas/listReminderOccurrencesParams';
import type { ReminderOccurrence } from '@service-storage/generated/schemas/reminderOccurrence';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { reminderKeys } from './keys';

const REMINDER_OCCURRENCES_STALE_TIME = 60_000;

export interface ReminderOccurrencesQueryOptions {
  enabled?: boolean;
  refetchOnWindowFocus?: boolean;
}

/**
 * Every firing of the caller's reminders inside one window, soonest first.
 *
 * `params` is undefined until the window is known, which keeps the query idle.
 */
export function useReminderOccurrencesQuery(
  params: Accessor<ListReminderOccurrencesParams | undefined>,
  options?: Accessor<ReminderOccurrencesQueryOptions>
) {
  return useQuery(() => {
    const request = params();

    return {
      queryKey: reminderKeys.occurrences(request ?? { start: '', end: '' })
        .queryKey,
      queryFn: async ({ signal }: { signal?: AbortSignal }) => {
        if (!request) {
          throw new Error('Reminder occurrence window is unavailable');
        }

        const response = await throwOnErr(() =>
          storageServiceClient.reminders.listReminderOccurrences({
            ...request,
            signal,
          })
        );
        return response.occurrences;
      },
      enabled: request !== undefined && options?.().enabled !== false,
      staleTime: REMINDER_OCCURRENCES_STALE_TIME,
      placeholderData: (previous: ReminderOccurrence[] | undefined) => previous,
      refetchOnWindowFocus: options?.().refetchOnWindowFocus ?? true,
    };
  });
}

/**
 * Move every cached firing of a reminder by `deltaMs`, so a dragged chip stays
 * where it was dropped until the refetch that follows the update lands.
 */
export function shiftCachedReminderOccurrences(
  reminderId: string,
  deltaMs: number
) {
  queryClient.setQueriesData<ReminderOccurrence[]>(
    { queryKey: reminderKeys.occurrences._def },
    (occurrences) =>
      occurrences?.map((occurrence) =>
        occurrence.reminderId === reminderId
          ? {
              ...occurrence,
              scheduledFor: new Date(
                new Date(occurrence.scheduledFor).getTime() + deltaMs
              ).toISOString(),
            }
          : occurrence
      )
  );
}
