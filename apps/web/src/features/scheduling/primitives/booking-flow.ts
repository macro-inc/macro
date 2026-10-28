import { createSignal } from 'solid-js';
import { BookingRejectedError } from '../core/booking-error';
import type { BookingReceipt, BookingRequest } from '../core/types';

export type BookingSource = {
  slots: (
    profile: string,
    event: string,
    date: string,
    timeZone: string
  ) => Promise<{ startsAt: string; endsAt: string }[]>;
  book: (
    profile: string,
    event: string,
    request: BookingRequest
  ) => Promise<BookingReceipt>;
};

export function createBookingFlow(source: BookingSource, profileId: string) {
  const [slots, setSlots] = createSignal<
    { startsAt: string; endsAt: string }[]
  >([]);
  const [loading, setLoading] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  let attempted: { eventId: string; request: BookingRequest } | undefined;
  const [error, setError] = createSignal('');
  const [selected, setSelected] = createSignal<string>();
  const [receipt, setReceipt] = createSignal<BookingReceipt>();
  let generation = 0;
  let requestId = crypto.randomUUID();
  const chooseDate = async (
    eventId: string,
    date: string,
    timeZone: string
  ) => {
    if (submitting() || uncertain()) return;
    const current = ++generation;
    setSelected(undefined);
    setSlots([]);
    setError('');
    setLoading(true);
    requestId = crypto.randomUUID();
    try {
      const next = await source.slots(profileId, eventId, date, timeZone);
      if (current === generation) setSlots(next);
    } catch {
      if (current === generation)
        setError(
          'Availability could not be loaded. Please retry or contact the host.'
        );
    } finally {
      if (current === generation) setLoading(false);
    }
  };
  const submit = async (
    eventId: string,
    details: Omit<BookingRequest, 'startsAt' | 'requestId'>
  ) => {
    const startsAt = selected();
    if (!startsAt || submitting()) return;
    setSubmitting(true);
    setError('');
    try {
      attempted ??= { eventId, request: { ...details, startsAt, requestId } };
      setReceipt(
        await source.book(profileId, attempted.eventId, attempted.request)
      );
      setUncertain(false);
      attempted = undefined;
    } catch (error) {
      if (error instanceof BookingRejectedError) {
        attempted = undefined;
        setUncertain(false);
        setError(error.message);
      } else {
        setUncertain(true);
        setError(
          'We could not verify the response. Your time may already be reserved. Retry this same request to check it; do not make another booking.'
        );
      }
    } finally {
      setSubmitting(false);
    }
  };
  return {
    reset: () => {
      if (submitting() || uncertain()) return;
      attempted = undefined;
      generation++;
      setSlots([]);
      setSelected(undefined);
      setReceipt(undefined);
      setLoading(false);
      setError('');
      requestId = crypto.randomUUID();
    },
    slots,
    loading,
    submitting,
    uncertain,
    error,
    selected,
    receipt,
    chooseDate,
    submit,
    select: (start: string) => {
      if (submitting() || uncertain()) return;
      setSelected(start);
      requestId = crypto.randomUUID();
    },
    back: () => {
      if (!submitting() && !uncertain()) setSelected(undefined);
    },
  };
}
