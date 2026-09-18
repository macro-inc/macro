import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { RescheduleForm } from '../components/reschedule-form';
import type { BookingReceipt } from '../core/types';

export function BookingReceiptView(props: {
  receipt?: BookingReceipt;
  unavailable: boolean;
  cancel: () => Promise<void>;
  loadSlots: (date: string) => Promise<{ startsAt: string; endsAt: string }[]>;
  reschedule: (start: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = createSignal(false);
  const [rescheduling, setRescheduling] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const cancel = async () => {
    setBusy(true);
    try {
      await props.cancel();
      setRescheduling(false);
      setConfirm(false);
    } catch {
      setError(
        'Cancellation failed. Your booking has not been marked cancelled. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="min-h-screen bg-panel px-4 py-20 text-ink">
      <div class="mx-auto max-w-lg rounded-2xl border border-edge-muted bg-surface-1 p-8">
        <Show
          when={props.receipt}
          fallback={
            <p>
              {props.unavailable
                ? 'We could not load this booking. Keep this private link and try again before making another booking.'
                : 'Loading booking…'}
            </p>
          }
        >
          {(r) => (
            <>
              <h1 class="text-2xl font-semibold">
                {r().booking.status === 'cancelled'
                  ? 'Booking cancelled'
                  : r().booking.status === 'pending'
                    ? 'Booking requested'
                    : r().booking.status === 'confirmed'
                      ? 'You’re booked'
                      : r().booking.status === 'failed'
                        ? 'We’re updating your booking'
                        : 'Booking is processing'}
              </h1>
              <h2 class="mt-6 font-semibold">{r().booking.title}</h2>
              <p class="mt-2 text-sm">
                {new Date(r().booking.startsAt).toLocaleString([], {
                  dateStyle: 'full',
                  timeStyle: 'short',
                  timeZone: r().booking.timeZone,
                })}
              </p>
              <p class="mt-1 text-sm text-ink-muted">
                {r().booking.timeZone.replaceAll('_', ' ')}
              </p>
              <p class="mt-4 text-sm">{r().booking.location}</p>
              <p class="mt-5 text-sm text-ink-muted">
                {r().booking.status === 'pending'
                  ? 'Your host will confirm this meeting. The time is held while they review it.'
                  : r().booking.status === 'confirmed'
                    ? 'A calendar invitation has been sent to your email.'
                    : r().booking.status === 'failed'
                      ? 'Your time is reserved. We’re retrying the calendar update automatically; keep this page to check its status and avoid making another booking.'
                      : ''}
              </p>
              <p class="mt-3 text-xs text-ink-muted">
                Keep this private link to manage your booking.
              </p>
              <Show
                when={
                  r().booking.status === 'confirmed' ||
                  r().booking.status === 'pending'
                }
              >
                <div class="mt-6 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy()}
                    onClick={() => {
                      setConfirm(false);
                      setRescheduling(true);
                    }}
                  >
                    Reschedule
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy()}
                    onClick={() => {
                      setRescheduling(false);
                      setConfirm(true);
                    }}
                  >
                    Cancel booking
                  </Button>
                  <Show when={confirm()}>
                    <Button
                      variant="strong"
                      disabled={busy()}
                      onClick={() => void cancel()}
                    >
                      {busy() ? 'Cancelling…' : 'Confirm cancellation'}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirm(false)}>
                      Keep booking
                    </Button>
                  </Show>
                </div>
              </Show>
              <Show
                when={
                  rescheduling() &&
                  (r().booking.status === 'pending' ||
                    r().booking.status === 'confirmed')
                }
              >
                <RescheduleForm
                  timeZone={r().scheduleTimeZone}
                  load={props.loadSlots}
                  submit={async (start) => {
                    await props.reschedule(start);
                    setRescheduling(false);
                  }}
                  onCancel={() => setRescheduling(false)}
                />
              </Show>
              <Show when={error()}>
                <p role="alert" class="mt-4 text-sm text-failure">
                  {error()}
                </p>
              </Show>
            </>
          )}
        </Show>
      </div>
    </main>
  );
}
