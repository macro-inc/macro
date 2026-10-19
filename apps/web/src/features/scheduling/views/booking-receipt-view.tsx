import { fireAndForget } from '@core/util/fireAndForget';
import { Button, cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import { RescheduleForm } from '../components/reschedule-form';
import type { BookingReceipt } from '../core/types';

export function BookingReceiptView(props: {
  receipt?: BookingReceipt;
  unavailable: boolean;
  cancel: () => Promise<void>;
  loadSlots: (date: string) => Promise<{ startsAt: string; endsAt: string }[]>;
  reschedule: (start: string) => Promise<void>;
  /** Shown inside another Macro page, which already frames the receipt. */
  embedded?: boolean;
}) {
  const [confirm, setConfirm] = createSignal(false);
  const [rescheduling, setRescheduling] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const cancel = async () => {
    if (busy()) return;
    setError('');
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
    <main
      class={cn(
        'min-h-screen bg-panel px-4 text-ink',
        props.embedded ? 'py-4' : 'py-10 sm:py-16'
      )}
    >
      <div class="mx-auto max-w-xl rounded-2xl border border-edge-muted bg-surface-1 p-6 sm:p-9">
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
              <div
                aria-hidden="true"
                class="mb-5 flex size-12 items-center justify-center rounded-full bg-accent-bg text-xl text-accent"
              >
                {r().booking.status === 'confirmed'
                  ? '✓'
                  : r().booking.status === 'cancelled'
                    ? '−'
                    : '◷'}
              </div>
              <h1 class="text-2xl font-semibold tracking-tight">
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
              <div class="mt-6 rounded-xl bg-surface-0 p-5">
                <h2 class="font-semibold">{r().booking.title}</h2>
                <dl class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
                  <dt class="text-ink-muted">When</dt>
                  <dd>
                    {new Date(r().booking.startsAt).toLocaleString([], {
                      dateStyle: 'full',
                      timeStyle: 'short',
                      timeZone: r().booking.timeZone,
                    })}
                  </dd>
                  <dt class="text-ink-muted">Time zone</dt>
                  <dd class="break-words">
                    {r().booking.timeZone.replaceAll('_', ' ')}
                  </dd>
                  <Show when={r().booking.location}>
                    <dt class="text-ink-muted">Where</dt>
                    <dd class="break-words">{r().booking.location}</dd>
                  </Show>
                  <dt class="text-ink-muted">Guest</dt>
                  <dd class="min-w-0 break-words">
                    {r().booking.name}
                    <span class="mt-1 block text-xs text-ink-muted">
                      {r().booking.email}
                    </span>
                  </dd>
                </dl>
              </div>
              <p class="mt-5 text-sm text-ink-muted">
                {r().booking.status === 'pending'
                  ? 'Your host will confirm this meeting. The time is held while they review it.'
                  : r().booking.status === 'confirmed'
                    ? 'A calendar invitation has been sent to your email.'
                    : r().booking.status === 'failed'
                      ? 'Your time is reserved. We’re retrying the calendar update automatically; keep this page to check its status and avoid making another booking.'
                      : ''}
              </p>
              <p class="mt-4 text-xs leading-relaxed text-ink-muted">
                Keep this private link to reschedule or cancel your booking.
              </p>
              <Show
                when={
                  r().booking.status === 'confirmed' ||
                  r().booking.status === 'pending'
                }
              >
                <div class="mt-6 flex flex-wrap gap-2 border-t border-edge-muted pt-6">
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
                      onClick={() => fireAndForget(cancel(), 'scheduling')}
                    >
                      {busy() ? 'Cancelling…' : 'Confirm cancellation'}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy()}
                      onClick={() => setConfirm(false)}
                    >
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
                  load={props.loadSlots}
                  submit={async (start) => {
                    setError('');
                    setBusy(true);
                    try {
                      await props.reschedule(start);
                      setRescheduling(false);
                    } finally {
                      setBusy(false);
                    }
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
      <p class="mt-7 text-center text-xs text-ink-muted">Scheduling by Macro</p>
    </main>
  );
}
