import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { schedulingClient } from '@service-email/scheduling';
import { BookingRejectedError } from '../core/booking-error';
import type { BookingRequest } from '../core/types';
import { schedulingKeys } from './keys';

export const publicSchedulingSource = {
  profile: async (id: string) =>
    (await throwOnErr(() => schedulingClient.profile(id))).profile,
  slots: async (
    profile: string,
    event: string,
    date: string,
    timeZone: string
  ) =>
    queryClient.fetchQuery({
      queryKey: schedulingKeys.slots(profile, event, `${date}:${timeZone}`)
        .queryKey,
      staleTime: 0,
      queryFn: async () =>
        (
          await throwOnErr(() =>
            schedulingClient.slots(profile, event, date, timeZone)
          )
        ).slots,
    }),
  book: async (profile: string, event: string, request: BookingRequest) => {
    try {
      return await throwOnErr(() =>
        schedulingClient.book(profile, event, request)
      );
    } catch (error) {
      if (
        error instanceof ThrownResultError &&
        error.errors.every(
          (e) =>
            ['CONFLICT', 'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN'].includes(
              e.code
            ) ||
            (e.code === 'HTTP_ERROR' &&
              /status: (400|429)$/.test(e.message ?? ''))
        )
      )
        throw new BookingRejectedError(
          'The request was not accepted. Check your details and refresh availability before trying again.'
        );
      throw error;
    }
  },
  receipt: async (id: string, token: string) =>
    throwOnErr(() => schedulingClient.receipt(id, token)),
  replacementSlots: async (id: string, token: string, date: string) =>
    (await throwOnErr(() => schedulingClient.replacementSlots(id, token, date)))
      .slots,
  reschedule: async (id: string, token: string, startsAt: string) =>
    throwOnErr(() => schedulingClient.reschedule(id, token, startsAt)),
  cancel: async (id: string, token: string) =>
    (await throwOnErr(() => schedulingClient.cancelPublic(id, token))).booking,
};
