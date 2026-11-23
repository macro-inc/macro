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
 * How a booking sent without a definite answer is being finished: resent
 * automatically, resent for long enough to say so, or out of automatic
 * resends and waiting for the visitor to try again.
 */
export type FinishState = 'resending' | 'slow' | 'paused';

/**
 * Waits before each automatic resend. Every resend that reaches the server
 * before a booking exists spends the link's shared public booking budget, so
 * the resends stop after these and wait for the visitor.
 */
const RESEND_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 15000];
/** Unanswered resends before the visitor is told it is taking longer. */
const SLOW_AFTER_RESENDS = 4;

export function createBookingFlow(source: BookingSource, profileId: string) {
  const [slots, setSlots] = createSignal<
    { startsAt: string; endsAt: string }[]
  >([]);
  const [loading, setLoading] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  // A booking sent without a definite answer (the connection dropped, or the
  // server failed) may already be reserved, so only that same request is sent
  // again until the server answers it.
  const [finishState, setFinishState] = createSignal<FinishState>();
  const finishing = () => finishState() !== undefined;
  let pending: PendingBooking | undefined;
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
  /** Send the held request once; true when the server settled it. */
  const send = async (held: PendingBooking) => {
    try {
      setReceipt(await source.book(profileId, held.eventId, held.request));
    } catch (error) {
      if (!(error instanceof BookingRejectedError)) return false;
      setError(error.message);
    }
    pending = undefined;
    setFinishState(undefined);
    return true;
  };
  const finish = async (held: PendingBooking) => {
    setFinishState('resending');
    for (const [resend, delay] of RESEND_DELAYS_MS.entries()) {
      await sleep(delay);
      if (disposed || (await send(held))) return;
      if (resend + 1 >= SLOW_AFTER_RESENDS) setFinishState('slow');
    }
    setFinishState('paused');
  };
  const submit = async (
    eventId: string,
    details: Omit<BookingRequest, 'startsAt' | 'requestId'>
  ) => {
    const startsAt = selected();
    if (!startsAt || submitting()) return;
    if (finishing() && finishState() !== 'paused') return;
    pending ??= { eventId, request: { ...details, startsAt, requestId } };
    const held = pending;
    if (finishing()) setFinishState('resending');
    setSubmitting(true);
    setError('');
    const settled = await send(held);
    setSubmitting(false);
    if (!settled) await finish(held);
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
    finishState,
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
