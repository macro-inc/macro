import { Button } from '@ui';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import {
  Field,
  TextArea,
  TextInput,
  TimeZoneInput,
} from '../components/fields';
import type { BookingReceipt, PublicEvent, PublicProfile } from '../core/types';
import {
  type BookingSource,
  createBookingFlow,
} from '../primitives/booking-flow';

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function PublicBookingView(props: {
  profile: PublicProfile;
  event?: PublicEvent;
  source: BookingSource;
  onEvent: (slug: string) => void;
  onReceipt: (r: BookingReceipt) => void;
}) {
  const flow = createBookingFlow(props.source, props.profile.id);
  const [month, setMonth] = createSignal(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );
  const [date, setDate] = createSignal('');
  const [zone, setZone] = createSignal(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [name, setName] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [answers, setAnswers] = createSignal<Record<string, string>>({});
  createEffect(
    on(
      () => props.event?.id,
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
  const days = () =>
    Array.from(
      {
        length: new Date(
          month().getFullYear(),
          month().getMonth() + 1,
          0
        ).getDate(),
      },
      (_, i) => new Date(month().getFullYear(), month().getMonth(), i + 1)
    );
  const choose = (value: string) => {
    setDate(value);
    if (props.event) void flow.chooseDate(props.event.id, value, zone());
  };
  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (!props.event) return;
    await flow.submit(props.event.id, {
      name: name(),
      email: email(),
      answers: answers(),
      timeZone: zone(),
    });
    const r = flow.receipt();
    if (r) props.onReceipt(r);
  };
  return (
    <main class="min-h-screen overflow-y-auto bg-panel px-4 py-12 text-ink sm:py-20">
      <div class="mx-auto max-w-4xl">
        <a
          href="https://macro.com"
          class="mb-8 inline-block text-lg font-semibold tracking-tight"
        >
          Macro
          <span class="ml-2 text-sm font-normal text-ink-muted">
            Scheduling
          </span>
        </a>
        <Show
          when={props.event}
          fallback={
            <section class="mx-auto max-w-xl">
              <h1 class="text-3xl font-semibold">{props.profile.name}</h1>
              <p class="mt-3 whitespace-pre-wrap text-ink-muted">
                {props.profile.description}
              </p>
              <div class="mt-8 flex flex-col gap-3">
                <For
                  each={props.profile.eventTypes}
                  fallback={
                    <p class="rounded-xl border border-edge-muted p-8 text-sm text-ink-muted">
                      There are no bookable events right now.
                    </p>
                  }
                >
                  {(event) => (
                    <button
                      type="button"
                      class="rounded-xl border border-edge-muted bg-surface-1 p-6 text-left hover:bg-hover"
                      onClick={() => props.onEvent(event.slug)}
                    >
                      <h2 class="font-semibold">
                        {event.title} <span class="float-right">→</span>
                      </h2>
                      <p class="mt-2 text-sm text-ink-muted">
                        {event.durationMinutes} minutes ·{' '}
                        {event.googleMeet
                          ? 'Google Meet'
                          : event.location || 'Meeting'}
                      </p>
                      <p class="mt-3 text-sm text-ink-muted">
                        {event.description}
                      </p>
                    </button>
                  )}
                </For>
              </div>
            </section>
          }
        >
          {(event) => (
            <section class="grid overflow-hidden rounded-2xl border border-edge-muted bg-surface-1 md:grid-cols-[280px_1fr]">
              <aside class="border-b border-edge-muted p-7 md:border-r md:border-b-0">
                <p class="text-sm text-ink-muted">{props.profile.name}</p>
                <h1 class="mt-3 text-2xl font-semibold">{event().title}</h1>
                <p class="mt-5 text-sm">◷ {event().durationMinutes} minutes</p>
                <p class="mt-3 text-sm">
                  {event().googleMeet
                    ? 'Google Meet'
                    : event().location || 'Meeting'}
                </p>
                <p class="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                  {event().description}
                </p>
                <Show when={flow.selected()}>
                  <p class="mt-5 text-sm font-medium">
                    {new Date(flow.selected()!).toLocaleString([], {
                      timeZone: zone(),
                      dateStyle: 'full',
                      timeStyle: 'short',
                    })}
                  </p>
                </Show>
                <div class="mt-6">
                  <Field label="Your time zone">
                    <TimeZoneInput
                      value={zone()}
                      disabled={flow.submitting() || flow.uncertain()}
                      onChange={(value) => {
                        setZone(value);
                        if (date()) choose(date());
                      }}
                    />
                  </Field>
                </div>
              </aside>
              <div class="p-7">
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
                        disabled={flow.submitting() || flow.uncertain()}
                      >
                        ← Choose another time
                      </Button>
                      <h2 class="text-lg font-semibold">Your details</h2>
                      <Field label="Name">
                        <TextInput
                          required
                          disabled={flow.submitting() || flow.uncertain()}
                          autocomplete="name"
                          value={name()}
                          onInput={(e) => setName(e.currentTarget.value)}
                        />
                      </Field>
                      <Field label="Email address">
                        <TextInput
                          type="email"
                          disabled={flow.submitting() || flow.uncertain()}
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
                              disabled={flow.submitting() || flow.uncertain()}
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
                        disabled={flow.submitting()}
                      >
                        {flow.submitting()
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
                  <h2 class="text-lg font-semibold">Select a date & time</h2>
                  <div class="mt-5 flex items-center justify-between">
                    <span class="font-medium">
                      {month().toLocaleDateString([], {
                        month: 'long',
                        year: 'numeric',
                      })}
                    </span>
                    <div class="flex gap-1">
                      <Button
                        variant="ghost"
                        label="Previous month"
                        disabled={
                          month() <=
                          new Date(
                            new Date().getFullYear(),
                            new Date().getMonth(),
                            1
                          )
                        }
                        onClick={() =>
                          setMonth(
                            new Date(
                              month().getFullYear(),
                              month().getMonth() - 1,
                              1
                            )
                          )
                        }
                      >
                        ‹
                      </Button>
                      <Button
                        variant="ghost"
                        label="Next month"
                        onClick={() =>
                          setMonth(
                            new Date(
                              month().getFullYear(),
                              month().getMonth() + 1,
                              1
                            )
                          )
                        }
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
                    <For each={Array.from({ length: month().getDay() })}>
                      {() => <span />}
                    </For>
                    <For each={days()}>
                      {(d) => (
                        <Button
                          variant={date() === dateKey(d) ? 'strong' : 'ghost'}
                          class="h-auto w-full aspect-square"
                          disabled={dateKey(d) < today()}
                          aria-label={d.toLocaleDateString([], {
                            dateStyle: 'full',
                          })}
                          onClick={() => choose(dateKey(d))}
                        >
                          {d.getDate()}
                        </Button>
                      )}
                    </For>
                  </div>
                  <Show when={date()}>
                    <div class="mt-6 border-t border-edge-muted pt-5">
                      <div class="mb-3 flex items-center justify-between">
                        <h3 class="text-sm font-semibold">Available times</h3>
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
                                  No times available. Please choose another
                                  date.
                                </p>
                              </Show>
                            }
                          >
                            {(slot) => (
                              <Button
                                variant="outline"
                                onClick={() => flow.select(slot.startsAt)}
                              >
                                {new Date(slot.startsAt).toLocaleTimeString(
                                  [],
                                  {
                                    timeZone: zone(),
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  }
                                )}
                              </Button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </Show>
              </div>
            </section>
          )}
        </Show>
        <p class="mt-8 text-center text-xs text-ink-muted">
          Scheduling by Macro
        </p>
      </div>
    </main>
  );
}
