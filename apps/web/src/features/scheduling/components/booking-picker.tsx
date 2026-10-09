import { Button } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from 'solid-js';
import type { BookingReceipt, PublicEvent, PublicProfile } from '../core/types';
import {
  type BookingSource,
  createBookingFlow,
} from '../primitives/booking-flow';
import { Field, TextArea, TextInput, TimeZoneInput } from './fields';

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Books one event: date and time selection, attendee details, and submission.
 * Sized by its own container, so it fits a page card or a form column.
 */
export function BookingPicker(props: {
  profile: PublicProfile;
  event: PublicEvent;
  source: BookingSource;
  onReceipt: (receipt: BookingReceipt) => void;
  /** Shows real availability but never books: an author's preview. */
  preview?: boolean;
}) {
  const flow = createBookingFlow(props.source, props.profile.id);
  // An in-flight or uncertain request stays on its own event until resolved,
  // so a retry never books an event other than the one on screen.
  const [held, setHeld] = createSignal<PublicEvent>();
  const event = () => held() ?? props.event;
  // Memoized so a refetched copy of the same event keeps the selection.
  const eventId = createMemo(() => event().id);
  const locked = () => flow.submitting() || flow.uncertain();
  const [date, setDate] = createSignal('');
  const [zone, setZone] = createSignal(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [answers, setAnswers] = createSignal<Record<string, string>>({});
  createEffect(
    on(
      eventId,
      () => {
        setDate('');
        setAnswers({});
        flow.reset();
      },
      { defer: true }
    )
  );
  const today = () => {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: zone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    return ['year', 'month', 'day']
      .map((k) => parts.find((p) => p.type === k)?.value)
      .join('-');
  };
  const currentMonth = () => new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
  const [month, setMonth] = createSignal(currentMonth());
  const shiftMonth = (by: number) =>
    setMonth(
      new Date(
        Date.UTC(month().getUTCFullYear(), month().getUTCMonth() + by, 1)
      )
    );
  const days = () =>
    Array.from(
      {
        length: new Date(
          Date.UTC(month().getUTCFullYear(), month().getUTCMonth() + 1, 0)
        ).getUTCDate(),
      },
      (_, i) =>
        new Date(
          Date.UTC(month().getUTCFullYear(), month().getUTCMonth(), i + 1)
        )
    );
  const choose = (value: string) => {
    setDate(value);
    void flow.chooseDate(event().id, value, zone());
  };
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (props.preview) return;
    const booking = event();
    setHeld(booking);
    await flow.submit(booking.id, {
      name: name(),
      email: email(),
      answers: answers(),
      timeZone: zone(),
    });
    const receipt = flow.receipt();
    if (receipt) props.onReceipt(receipt);
    if (!flow.uncertain()) setHeld(undefined);
  };
  return (
    <section class="@container overflow-hidden rounded-2xl border border-edge-muted bg-surface-1 text-ink">
      <div class="grid @2xl:grid-cols-[280px_1fr]">
        <aside class="border-b border-edge-muted p-5 @md:p-7 @2xl:border-r @2xl:border-b-0">
          <p class="text-sm text-ink-muted">{props.profile.name}</p>
          <h2 class="mt-3 text-2xl font-semibold">{event().title}</h2>
          <p class="mt-5 text-sm">◷ {event().durationMinutes} minutes</p>
          <p class="mt-3 text-sm">
            {event().googleMeet ? 'Google Meet' : event().location || 'Meeting'}
          </p>
          <p class="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
            {event().description}
          </p>
          <Show when={flow.selected()}>
            {(selected) => (
              <p class="mt-5 text-sm font-medium">
                {new Date(selected()).toLocaleString([], {
                  timeZone: zone(),
                  dateStyle: 'full',
                  timeStyle: 'short',
                })}
              </p>
            )}
          </Show>
          <div class="mt-6">
            <Field label="Your time zone">
              <TimeZoneInput
                value={zone()}
                disabled={locked()}
                onChange={(value) => {
                  setZone(value);
                  setMonth(currentMonth());
                  setDate('');
                  flow.reset();
                }}
              />
            </Field>
          </div>
        </aside>
        <div class="min-w-0 p-5 @md:p-7">
          <Show when={flow.error()}>
            <p
              role="alert"
              class="mb-4 rounded-lg border border-edge-muted p-3 text-sm text-failure"
            >
              {flow.error()}
            </p>
          </Show>
          <Show
            when={!flow.selected()}
            fallback={
              <form
                class="flex flex-col gap-5"
                onSubmit={(e) => void submit(e)}
              >
                <Button
                  variant="ghost"
                  class="self-start"
                  onClick={flow.back}
                  disabled={locked()}
                >
                  ← Choose another time
                </Button>
                <h3 class="text-lg font-semibold">Your details</h3>
                <Field label="Name">
                  <TextInput
                    required
                    disabled={locked()}
                    autocomplete="name"
                    value={name()}
                    onInput={(e) => setName(e.currentTarget.value)}
                  />
                </Field>
                <Field label="Email address">
                  <TextInput
                    type="email"
                    disabled={locked()}
                    required
                    autocomplete="email"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                  />
                </Field>
                <For each={event().questions}>
                  {(q) => (
                    <Field label={`${q.label}${q.required ? ' *' : ''}`}>
                      <TextArea
                        disabled={locked()}
                        required={q.required}
                        value={answers()[q.id] ?? ''}
                        onInput={(e) =>
                          setAnswers({
                            ...answers(),
                            [q.id]: e.currentTarget.value,
                          })
                        }
                      />
                    </Field>
                  )}
                </For>
                <Button
                  type="submit"
                  variant="strong"
                  disabled={flow.submitting() || props.preview}
                >
                  {props.preview
                    ? 'Booking is off in preview'
                    : flow.submitting()
                      ? 'Booking…'
                      : flow.uncertain()
                        ? 'Check booking status'
                        : event().requiresConfirmation
                          ? 'Request booking'
                          : 'Confirm booking'}
                </Button>
                <p class="text-xs text-ink-muted">
                  Your details are shared with the meeting hosts.
                </p>
              </form>
            }
          >
            <h3 class="text-lg font-semibold">Select a date & time</h3>
            <div class="mt-5 flex items-center justify-between">
              <span class="font-medium">
                {month().toLocaleDateString([], {
                  timeZone: 'UTC',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              <div class="flex gap-1">
                <Button
                  variant="ghost"
                  label="Previous month"
                  disabled={month() <= currentMonth()}
                  onClick={() => shiftMonth(-1)}
                >
                  ‹
                </Button>
                <Button
                  variant="ghost"
                  label="Next month"
                  onClick={() => shiftMonth(1)}
                >
                  ›
                </Button>
              </div>
            </div>
            <div class="mt-3 grid grid-cols-7 gap-1">
              <For each={['S', 'M', 'T', 'W', 'T', 'F', 'S']}>
                {(day) => (
                  <span class="py-2 text-center text-xs text-ink-muted">
                    {day}
                  </span>
                )}
              </For>
              <For each={Array.from({ length: month().getUTCDay() })}>
                {() => <span />}
              </For>
              <For each={days()}>
                {(d) => (
                  <Button
                    variant={date() === dateKey(d) ? 'strong' : 'ghost'}
                    class="h-auto w-full aspect-square"
                    disabled={dateKey(d) < today()}
                    aria-label={d.toLocaleDateString([], {
                      timeZone: 'UTC',
                      dateStyle: 'full',
                    })}
                    onClick={() => choose(dateKey(d))}
                  >
                    {d.getUTCDate()}
                  </Button>
                )}
              </For>
            </div>
            <Show when={date()}>
              <div class="mt-6 border-t border-edge-muted pt-5">
                <div class="mb-3 flex items-center justify-between">
                  <h4 class="text-sm font-semibold">Available times</h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => choose(date())}
                  >
                    Refresh
                  </Button>
                </div>
                <Show
                  when={!flow.loading()}
                  fallback={
                    <p role="status" class="text-sm text-ink-muted">
                      Checking calendars…
                    </p>
                  }
                >
                  <div class="grid grid-cols-2 gap-2">
                    <For
                      each={flow.slots()}
                      fallback={
                        <Show when={!flow.error()}>
                          <p class="col-span-2 text-sm text-ink-muted">
                            No times available. Please choose another date.
                          </p>
                        </Show>
                      }
                    >
                      {(slot) => (
                        <Button
                          variant="outline"
                          onClick={() => flow.select(slot.startsAt)}
                        >
                          {new Date(slot.startsAt).toLocaleTimeString([], {
                            timeZone: zone(),
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </Button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </section>
  );
}
