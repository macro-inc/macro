import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { schedulingClient } from '@service-email/scheduling';
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  BookingRejectedError,
  RescheduleRefusedError,
} from '../core/booking-error';
import type { Booking, BookingReceipt, BookingRequest } from '../core/types';
import { schedulingKeys } from './keys';

function validateReceipt(receipt: BookingReceipt): BookingReceipt {
  if (
    !receipt ||
    typeof receipt.booking?.id !== 'string' ||
    !receipt.booking.id ||
    typeof receipt.token !== 'string' ||
    !receipt.token ||
    typeof receipt.scheduleTimeZone !== 'string' ||
    !receipt.scheduleTimeZone
  ) {
    throw new Error(
      'The booking response is incomplete. Retry the original request.'
    );
  }
  return receipt;
}

function publicProfileQueryOptions(id: string) {
  return queryOptions({
    queryKey: schedulingKeys.publicProfile(id).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.profile(id))).profile,
    retry: false,
  });
}

export function usePublicProfileQuery(id: Accessor<string>) {
  return useQuery(() => publicProfileQueryOptions(id()));
}

function slotsQueryOptions(
  profile: string,
  event: string,
  date: string,
  timeZone: string
) {
  return queryOptions({
    queryKey: schedulingKeys.slots(profile, event, `${date}:${timeZone}`)
      .queryKey,
    staleTime: 0,
    retry: false,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          schedulingClient.slots(profile, event, date, timeZone)
        )
      ).slots,
  });
}

/**
 * A processing booking is finishing its calendar write and settles in
 * seconds; a failed one waits on recovery's backoff.
 */
function receiptRefetchInterval(query: {
  state: { data?: BookingReceipt };
}): number | false {
  const booking = query.state.data?.booking;
  if (booking?.status === 'processing') return 2000;
  if (booking?.status === 'failed' && !booking.abandonedAt) return 5000;
  return false;
}

function receiptQueryOptions(id: string, token: string) {
  return queryOptions({
    queryKey: schedulingKeys.receipt(id, token).queryKey,
    queryFn: async () =>
      validateReceipt(
        await throwOnErr(() => schedulingClient.receipt(id, token))
      ),
    retry: false,
    gcTime: 0,
    refetchInterval: receiptRefetchInterval,
  });
}

function replacementSlotsQueryOptions(
  id: string,
  token: string,
  date: string,
  timeZone: string
) {
  return queryOptions({
    queryKey: schedulingKeys.replacementSlots(id, token, date, timeZone)
      .queryKey,
    queryFn: async () =>
      (
        await throwOnErr(() =>
          schedulingClient.replacementSlots(id, token, date, timeZone)
        )
      ).slots,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}

export function createPublicBookingSource() {
  const book = useMutation(() => ({
    retry: false,
    mutationFn: async (args: {
      profile: string;
      event: string;
      request: BookingRequest;
    }) => {
      try {
        return validateReceipt(
          await throwOnErr(() =>
            schedulingClient.book(args.profile, args.event, args.request)
          )
        );
      } catch (error) {
        if (
          error instanceof ThrownResultError &&
          error.errors.length > 0 &&
          error.errors.every(
            (e) =>
              ['CONFLICT', 'NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN'].includes(
                e.code
              ) ||
              (e.code === 'HTTP_ERROR' &&
                /status: (400|413|422|429)$/.test(e.message ?? ''))
          )
        ) {
          throw new BookingRejectedError(
            'The request was not accepted. Check your details and refresh availability before trying again.'
          );
        }
        throw error;
      }
    },
  }));
  return {
    slots: (profile: string, event: string, date: string, timeZone: string) =>
      queryClient.fetchQuery(slotsQueryOptions(profile, event, date, timeZone)),
    book: (profile: string, event: string, request: BookingRequest) =>
      book.mutateAsync({ profile, event, request }),
  };
}

export function createBookingReceiptSource(
  id: Accessor<string>,
  token: Accessor<string>
) {
  const receipt = useQuery(() => receiptQueryOptions(id(), token()));
  const client = useQueryClient();
  const receiptKey = () => receiptQueryOptions(id(), token()).queryKey;
  // Show the changed booking even if the refresh that follows fails. The key
  // is read before the request, so a route change cannot redirect the write.
  const keep = (key: ReturnType<typeof receiptKey>, booking: Booking) =>
    client.setQueryData(key, (current) =>
      current ? { ...current, booking } : current
    );
  const cancel = useMutation(() => ({
    mutationFn: () =>
      throwOnErr(() => schedulingClient.cancelPublic(id(), token())),
    retry: false,
  }));
  const reschedule = useMutation(() => ({
    mutationFn: async (startsAt: string) => {
      try {
        return await throwOnErr(() =>
          schedulingClient.reschedule(id(), token(), startsAt)
        );
      } catch (error) {
        if (
          error instanceof ThrownResultError &&
          error.errors.some(
            (e) =>
              e.code === 'HTTP_ERROR' && /status: 422$/.test(e.message ?? '')
          )
        )
          throw new RescheduleRefusedError();
        throw error;
      }
    },
    retry: false,
  }));
  return {
    receipt,
    cancel: async () => {
      const key = receiptKey();
      const { booking } = await cancel.mutateAsync().catch(async (error) => {
        // A lost response may hide a change that landed: read it back once.
        await receipt.refetch();
        throw error;
      });
      keep(key, booking);
      await receipt.refetch();
      return booking;
    },
    reschedule: async (startsAt: string) => {
      const key = receiptKey();
      const moved = await reschedule
        .mutateAsync(startsAt)
        .catch(async (error) => {
          await receipt.refetch();
          throw error;
        });
      keep(key, moved.booking);
      await receipt.refetch();
    },
    replacementSlots: (date: string, timeZone: string) =>
      queryClient.fetchQuery(
        replacementSlotsQueryOptions(id(), token(), date, timeZone)
      ),
  };
}
