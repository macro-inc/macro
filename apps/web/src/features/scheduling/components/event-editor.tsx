import ArrowLeft from '@phosphor/arrow-left.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CheckCircle from '@phosphor/check-circle.svg';
import ClockIcon from '@phosphor/clock.svg';
import GearIcon from '@phosphor/gear.svg';
import Sliders from '@phosphor/sliders-horizontal.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import { Button } from '@ui';
import { createSignal, For, Index, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import {
  type AvailabilitySchedule,
  type EventType,
  type SchedulingMember,
  slugify,
  validateEvent,
  WEEKDAYS,
} from '../core/types';
import { CheckField, Field, SelectInput, TextArea, TextInput } from './fields';

export function EventEditor(props: {
  event: EventType;
  events: EventType[];
  schedules: AvailabilitySchedule[];
  members: SchedulingMember[];
  team: boolean;
  saving: boolean;
  onSave: (event: EventType) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal(structuredClone(unwrap(props.event)));
  const [section, setSection] = createSignal('Basics');
  const [error, setError] = createSignal('');
  const update = <K extends keyof EventType>(key: K, value: EventType[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const save = async (e: SubmitEvent) => {
    e.preventDefault();
    const message = validateEvent(draft(), props.events);
    if (message) {
      setError(message);
      return;
    }
    if (props.team && missingHosts().length) {
      setSection('Hosts');
      setError(
        'Remove former team members from the selected hosts before saving.'
      );
      return;
    }
    setError('');
    try {
      await props.onSave(draft());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this event.');
    }
  };
  const missingHosts = () =>
    draft().hosts.filter(
      (id) => !props.members.some((member) => member.id === id)
    );
  const sections = () => [
    {
      label: 'Setup',
      items: [
        {
          name: 'Basics',
          icon: GearIcon,
          description: 'Set the details people see on your booking page.',
        },
        {
          name: 'Availability',
          icon: CalendarIcon,
          description: 'Choose when people can book this event.',
        },
        ...(props.team
          ? [
              {
                name: 'Hosts',
                icon: UsersIcon,
                description: 'Choose the people who will host this event.',
              },
            ]
          : []),
      ],
    },
    {
      label: 'Booking experience',
      items: [
        {
          name: 'Booking form',
          icon: TextAlignLeft,
          description: 'Collect the information you need before a meeting.',
        },
        {
          name: 'Confirmation',
          icon: CheckCircle,
          description: 'Choose how new bookings are accepted.',
        },
      ],
    },
    {
      label: 'Policies',
      items: [
        {
          name: 'Limits & buffers',
          icon: Sliders,
          description: 'Protect your time with notice, limits, and breaks.',
        },
      ],
    },
  ];
  const currentSection = () =>
    sections()
      .flatMap((group) => group.items)
      .find((item) => item.name === section());
  return (
    <form onSubmit={(e) => void save(e)} class="@container min-w-0">
      <div class="grid min-w-0 gap-6 @min-[760px]:grid-cols-[180px_minmax(0,1fr)] @min-[1100px]:gap-10">
        <aside class="min-w-0">
          <Button variant="ghost" class="mb-5 -ml-2" onClick={props.onCancel}>
            <ArrowLeft class="size-4" />
            Event types
          </Button>
          <nav
            aria-label="Event settings"
            class="flex gap-5 overflow-x-auto pb-2 @min-[760px]:flex-col @min-[760px]:gap-6"
          >
            <For each={sections()}>
              {(group) => (
                <div class="shrink-0">
                  <h2 class="mb-2 px-3 text-xs font-medium text-ink-muted">
                    {group.label}
                  </h2>
                  <div class="flex gap-1 @min-[760px]:flex-col">
                    <For each={group.items}>
                      {(item) => (
                        <button
                          type="button"
                          aria-current={
                            section() === item.name ? 'page' : undefined
                          }
                          onClick={() => setSection(item.name)}
                          class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm whitespace-nowrap text-ink-muted hover:bg-hover aria-[current=page]:bg-surface-2 aria-[current=page]:text-ink aria-[current=page]:font-medium focus-visible:outline-2 focus-visible:outline-ink"
                        >
                          <item.icon class="size-4" />
                          {item.name}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </nav>
        </aside>
        <div class="min-w-0">
          <header class="mb-7 flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h1 class="break-words text-2xl font-semibold tracking-tight">
                {draft().title || 'New event type'}
              </h1>
              <p class="mt-1 text-sm text-ink-muted">
                {draft().slug
                  ? `/${draft().slug}`
                  : 'Create a reusable booking link.'}
              </p>
            </div>
            <Button type="submit" variant="strong" disabled={props.saving}>
              {props.saving ? 'Saving…' : 'Save changes'}
            </Button>
          </header>
          <div class="grid min-w-0 items-start gap-6 @min-[1100px]:grid-cols-[minmax(0,1fr)_240px]">
            <section class="min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel">
              <div class="border-b border-edge-muted bg-surface-1 px-6 py-5">
                <h2 class="font-semibold">{section()}</h2>
                <p class="mt-1 text-sm text-ink-muted">
                  {currentSection()?.description}
                </p>
              </div>
              <div class="flex flex-col gap-5 p-6">
                <Show when={error()}>
                  <p role="alert" class="text-sm text-failure">
                    {error()}
                  </p>
                </Show>
                <Show when={section() === 'Basics'}>
                  <Field label="Title">
                    <TextInput
                      required
                      value={draft().title}
                      placeholder="30 minute meeting"
                      onInput={(e) => {
                        const title = e.currentTarget.value;
                        setDraft((d) => ({
                          ...d,
                          title,
                          slug:
                            d.slug === slugify(d.title)
                              ? slugify(title)
                              : d.slug,
                        }));
                      }}
                    />
                  </Field>
                  <Field
                    label="Link"
                    hint="A short, memorable name for your booking link."
                  >
                    <TextInput
                      required
                      value={draft().slug}
                      onInput={(e) => update('slug', e.currentTarget.value)}
                    />
                  </Field>
                  <Field label="Description">
                    <TextArea
                      value={draft().description}
                      placeholder="What should people know before booking?"
                      onInput={(e) =>
                        update('description', e.currentTarget.value)
                      }
                    />
                  </Field>
                  <Field label="Duration (minutes)" class="max-w-56">
                    <TextInput
                      type="number"
                      min="5"
                      max="480"
                      required
                      value={draft().durationMinutes}
                      onInput={(e) =>
                        update('durationMinutes', e.currentTarget.valueAsNumber)
                      }
                    />
                  </Field>
                  <CheckField
                    checked={draft().googleMeet}
                    onChange={(v) => update('googleMeet', v)}
                    label="Create a Google Meet link"
                  />
                  <Field
                    label={
                      draft().googleMeet
                        ? 'Additional location details'
                        : 'Location or meeting URL'
                    }
                  >
                    <TextInput
                      value={draft().location}
                      placeholder="Office address, phone number, or meeting URL"
                      onInput={(e) => update('location', e.currentTarget.value)}
                    />
                  </Field>
                  <CheckField
                    checked={draft().enabled}
                    onChange={(v) => update('enabled', v)}
                    label="Accept bookings"
                  />
                </Show>
                <Show when={section() === 'Availability'}>
                  <Field label="Availability schedule">
                    <SelectInput
                      label="Availability schedule"
                      value={draft().scheduleId}
                      options={props.schedules.map((s) => ({
                        value: s.id,
                        label: s.name,
                      }))}
                      onChange={(value) => update('scheduleId', value)}
                    />
                  </Field>
                  <Show
                    when={props.schedules.find(
                      (s) => s.id === draft().scheduleId
                    )}
                  >
                    {(schedule) => (
                      <div class="overflow-hidden rounded-lg border border-edge-muted">
                        <div class="border-b border-edge-muted bg-surface-2 px-4 py-3 text-sm font-medium">
                          Weekly hours{' '}
                          <span class="ml-2 font-normal text-ink-muted">
                            {schedule().timeZone.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <dl class="divide-y divide-edge-muted">
                          <For each={schedule().weekly}>
                            {(day) => (
                              <div class="flex flex-wrap justify-between gap-2 px-4 py-3 text-sm">
                                <dt>{WEEKDAYS[day.day]}</dt>
                                <dd class="text-ink-muted">
                                  {day.windows.length
                                    ? day.windows
                                        .map((w) => `${w.start} – ${w.end}`)
                                        .join(', ')
                                    : 'Unavailable'}
                                </dd>
                              </div>
                            )}
                          </For>
                        </dl>
                      </div>
                    )}
                  </Show>
                  <p class="text-sm text-ink-muted">
                    Busy events on each host’s connected calendar are excluded
                    automatically. Manage weekly hours and date overrides in
                    Availability.
                  </p>
                </Show>
                <Show when={section() === 'Hosts' && props.team}>
                  <Field label="Scheduling type">
                    <SelectInput
                      label="Scheduling type"
                      value={draft().mode}
                      options={[
                        {
                          value: 'collective',
                          label: 'Collective · all hosts attend',
                        },
                        {
                          value: 'roundRobin',
                          label: 'Round robin · one available host',
                        },
                      ]}
                      onChange={(value) =>
                        update(
                          'mode',
                          value === 'roundRobin' ? 'roundRobin' : 'collective'
                        )
                      }
                    />
                  </Field>
                  <div class="flex flex-col gap-3">
                    <h3 class="text-sm font-semibold">Team hosts</h3>
                    <For each={props.members}>
                      {(member) => (
                        <div class="rounded-lg border border-edge-muted p-4">
                          <CheckField
                            checked={draft().hosts.includes(member.id)}
                            onChange={(checked) =>
                              update(
                                'hosts',
                                checked
                                  ? [...draft().hosts, member.id]
                                  : draft().hosts.filter((h) => h !== member.id)
                              )
                            }
                            label={member.name || member.email}
                          />
                          <Show when={member.name}>
                            <p class="mt-1 ml-7 truncate text-xs text-ink-muted">
                              {member.email}
                            </p>
                          </Show>
                        </div>
                      )}
                    </For>
                    <For each={missingHosts()}>
                      {(id) => (
                        <div class="rounded-lg border border-warning/30 bg-warning-bg p-4">
                          <CheckField
                            checked={draft().hosts.includes(id)}
                            onChange={(checked) => {
                              if (!checked)
                                update(
                                  'hosts',
                                  draft().hosts.filter((host) => host !== id)
                                );
                            }}
                            label="Former team member"
                          />
                          <p class="mt-2 text-xs text-ink-muted">
                            This selected host is no longer in the team. Uncheck
                            them before saving.
                          </p>
                        </div>
                      )}
                    </For>
                  </div>
                  <p class="text-xs text-ink-muted">
                    Hosts must be current members of this Macro team with a
                    connected calendar. Round robin assigns the available host
                    with the fewest bookings.
                  </p>
                </Show>
                <Show when={section() === 'Limits & buffers'}>
                  <div class="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-2">
                    <For
                      each={[
                        {
                          key: 'beforeMinutes' as const,
                          label: 'Buffer before (minutes)',
                          max: 10080,
                          min: 0,
                        },
                        {
                          key: 'afterMinutes' as const,
                          label: 'Buffer after (minutes)',
                          max: 10080,
                          min: 0,
                        },
                        {
                          key: 'noticeMinutes' as const,
                          label: 'Minimum notice (minutes)',
                          max: 10080,
                          min: 0,
                        },
                        {
                          key: 'horizonDays' as const,
                          label: 'Booking window (days)',
                          max: 365,
                          min: 1,
                        },
                        {
                          key: 'intervalMinutes' as const,
                          label: 'Time-slot interval (minutes)',
                          max: 480,
                          min: 5,
                        },
                      ]}
                    >
                      {(field) => (
                        <Field label={field.label}>
                          <TextInput
                            type="number"
                            min={field.min}
                            max={field.max}
                            required
                            value={draft()[field.key]}
                            onInput={(e) =>
                              update(field.key, e.currentTarget.valueAsNumber)
                            }
                          />
                        </Field>
                      )}
                    </For>
                    <Field
                      label="Maximum bookings per day"
                      hint="Leave blank for no limit."
                    >
                      <TextInput
                        type="number"
                        min="1"
                        max="100"
                        value={draft().dailyLimit ?? ''}
                        onInput={(e) =>
                          update(
                            'dailyLimit',
                            e.currentTarget.value === ''
                              ? null
                              : e.currentTarget.valueAsNumber
                          )
                        }
                      />
                    </Field>
                  </div>
                </Show>
                <Show when={section() === 'Booking form'}>
                  <p class="text-sm text-ink-muted">
                    Name and email are always required. Add questions to prepare
                    for the meeting.
                  </p>
                  <Index each={draft().questions}>
                    {(q) => (
                      <div class="flex flex-col gap-3 rounded-lg border border-edge-muted p-4">
                        <Field label="Question">
                          <TextInput
                            value={q().label}
                            onInput={(e) =>
                              update(
                                'questions',
                                draft().questions.map((item) =>
                                  item.id === q().id
                                    ? { ...item, label: e.currentTarget.value }
                                    : item
                                )
                              )
                            }
                          />
                        </Field>
                        <div class="flex items-center justify-between">
                          <CheckField
                            checked={q().required}
                            label="Required"
                            onChange={(required) =>
                              update(
                                'questions',
                                draft().questions.map((item) =>
                                  item.id === q().id
                                    ? { ...item, required }
                                    : item
                                )
                              )
                            }
                          />
                          <Button
                            variant="ghost"
                            onClick={() =>
                              update(
                                'questions',
                                draft().questions.filter(
                                  (item) => item.id !== q().id
                                )
                              )
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    )}
                  </Index>
                  <Button
                    variant="outline"
                    onClick={() =>
                      update('questions', [
                        ...draft().questions,
                        { id: crypto.randomUUID(), label: '', required: false },
                      ])
                    }
                  >
                    Add a question
                  </Button>
                </Show>
                <Show when={section() === 'Confirmation'}>
                  <div class="rounded-lg border border-edge-muted p-4">
                    <p class="font-medium">Automatic confirmation</p>
                    <p class="mt-2 text-sm text-ink-muted">
                      Guests receive a calendar invitation as soon as they book
                      an available time.
                    </p>
                    <Show when={draft().requiresConfirmation}>
                      <Button
                        variant="outline"
                        onClick={() => update('requiresConfirmation', false)}
                      >
                        Enable automatic confirmation
                      </Button>
                      <p class="mt-2 text-sm text-ink-muted">
                        This link is paused until automatic confirmation is
                        enabled.
                      </p>
                    </Show>
                  </div>
                </Show>
              </div>
            </section>
            <aside class="hidden min-w-0 @min-[1100px]:block">
              <p class="mb-3 text-xs font-medium text-ink-muted">
                Booking preview
              </p>
              <div class="space-y-5 rounded-xl border border-edge-muted bg-panel p-5">
                <div>
                  <h3 class="break-words text-lg font-semibold">
                    {draft().title || 'New event type'}
                  </h3>
                  <Show when={draft().description}>
                    <p class="mt-3 whitespace-pre-wrap break-words text-sm text-ink-muted">
                      {draft().description}
                    </p>
                  </Show>
                </div>
                <div class="space-y-3 text-sm text-ink-muted">
                  <p class="flex items-center gap-2">
                    <ClockIcon class="size-4" />
                    {draft().durationMinutes || 0} minutes
                  </p>
                  <Show when={draft().googleMeet}>
                    <p class="flex items-center gap-2">
                      <VideoCamera class="size-4" />
                      Google Meet
                    </p>
                  </Show>
                  <Show when={draft().location}>
                    <p class="break-words">{draft().location}</p>
                  </Show>
                  <Show when={props.team}>
                    <p class="flex items-center gap-2">
                      <UsersIcon class="size-4" />
                      {draft().mode === 'roundRobin'
                        ? 'Round robin'
                        : 'Collective'}
                    </p>
                  </Show>
                  <Show when={draft().requiresConfirmation}>
                    <p class="flex items-center gap-2">
                      <CheckCircle class="size-4" />
                      Confirmation required
                    </p>
                  </Show>
                </div>
                <div class="border-t border-edge-muted pt-4 text-xs text-ink-muted">
                  {draft().enabled
                    ? 'Accepting bookings'
                    : 'Booking link is paused'}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </form>
  );
}
