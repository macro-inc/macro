import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { schedulingClient } from '@service-email/scheduling';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { BookingRejectedError } from '../core/booking-error';
import type { BookingReceipt, BookingRequest } from '../core/types';
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

export function usePublicProfileQuery(id: Accessor<string>) {
  return useQuery(() => ({
    queryKey: schedulingKeys.publicProfile(id()).queryKey,
    queryFn: async () =>
      (await throwOnErr(() => schedulingClient.profile(id()))).profile,
    retry: false,
  }));
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
      queryClient.fetchQuery({
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
      }),
    book: (profile: string, event: string, request: BookingRequest) =>
      book.mutateAsync({ profile, event, request }),
  };
}

export function createBookingReceiptSource(
  id: Accessor<string>,
  token: Accessor<string>
) {
  const receipt = useQuery(() => ({
    queryKey: schedulingKeys.receipt(id(), token()).queryKey,
    queryFn: async () =>
      validateReceipt(
        await throwOnErr(() => schedulingClient.receipt(id(), token()))
      ),
    retry: false,
    gcTime: 0,
    refetchInterval: (q) =>
      q.state.data?.booking.status === 'processing' ||
      q.state.data?.booking.status === 'failed'
        ? 5000
        : false,
  }));
  const cancel = useMutation(() => ({
    mutationFn: () =>
      throwOnErr(() => schedulingClient.cancelPublic(id(), token())),
    retry: false,
  }));
  const reschedule = useMutation(() => ({
    mutationFn: (startsAt: string) =>
      throwOnErr(() => schedulingClient.reschedule(id(), token(), startsAt)),
    retry: false,
  }));
  return {
    receipt,
    cancel: async () => {
      await cancel.mutateAsync();
      await receipt.refetch();
    },
    reschedule: async (startsAt: string) => {
      await reschedule.mutateAsync(startsAt);
      await receipt.refetch();
    },
    replacementSlots: (date: string) =>
      queryClient.fetchQuery({
        queryKey: schedulingKeys.replacementSlots(id(), token(), date).queryKey,
        queryFn: async () =>
          (
            await throwOnErr(() =>
              schedulingClient.replacementSlots(id(), token(), date)
            )
          ).slots,
        staleTime: 0,
        gcTime: 0,
        retry: false,
      }),
  };
}
