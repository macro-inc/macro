import { sleep } from '@core/util/sleep';
import { createSignal, onCleanup } from 'solid-js';
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

type PendingBooking = { eventId: string; request: BookingRequest };

/**
 * Waits between automatic retries of a booking whose outcome is unknown: the
 * last delay repeats until the booking settles or the page closes.
 */
const FINISH_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
/** Unanswered retries before the visitor is told it is taking longer. */
const STALLED_AFTER_RETRIES = 4;

export function createBookingFlow(source: BookingSource, profileId: string) {
  const [slots, setSlots] = createSignal<
    { startsAt: string; endsAt: string }[]
  >([]);
  const [loading, setLoading] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  // A booking sent without a definite answer (the connection dropped, or the
  // server failed): it may already be reserved, so the same request is sent
  // again until the server answers it.
  const [finishing, setFinishing] = createSignal(false);
  const [stalled, setStalled] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
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
    if (submitting() || finishing()) return;
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
  /** Send the request once; true when the server settled it. */
  const send = async (pending: PendingBooking) => {
    try {
      setReceipt(
        await source.book(profileId, pending.eventId, pending.request)
      );
    } catch (error) {
      if (!(error instanceof BookingRejectedError)) return false;
      setError(error.message);
    }
    setFinishing(false);
    setStalled(false);
    return true;
  };
  const finish = async (pending: PendingBooking) => {
    setFinishing(true);
    for (let retry = 0; ; retry++) {
      await sleep(
        FINISH_RETRY_DELAYS_MS[
          Math.min(retry, FINISH_RETRY_DELAYS_MS.length - 1)
        ]
      );
      if (disposed || (await send(pending))) return;
      if (retry + 1 >= STALLED_AFTER_RETRIES) setStalled(true);
    }
  };
  const submit = async (
    eventId: string,
    details: Omit<BookingRequest, 'startsAt' | 'requestId'>
  ) => {
    const startsAt = selected();
    if (!startsAt || submitting() || finishing()) return;
    setSubmitting(true);
    setError('');
    const pending = { eventId, request: { ...details, startsAt, requestId } };
    const settled = await send(pending);
    setSubmitting(false);
    if (!settled) await finish(pending);
  };
  return {
    reset: () => {
      if (submitting() || finishing()) return;
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
    finishing,
    stalled,
    error,
    selected,
    receipt,
    chooseDate,
    submit,
    select: (start: string) => {
      if (submitting() || finishing()) return;
      setSelected(start);
      requestId = crypto.randomUUID();
    },
    back: () => {
      if (!submitting() && !finishing()) setSelected(undefined);
    },
  };
}
