import {
  SettingsCard,
  SettingsSection,
} from '@app/features/settings/primitives';
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
  return (
    <form onSubmit={(e) => void save(e)} class="@container min-w-0">
      <div class="flex min-w-0 flex-col gap-5">
        <Button variant="ghost" class="self-start" onClick={props.onCancel}>
          Cancel editing
        </Button>
        <header class="mb-7 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="break-words text-base font-semibold">
              {draft().title || 'New event type'}
            </h3>
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
        <div class="flex min-w-0 flex-col gap-7">
          <Show when={error()}>
            <p role="alert" class="text-sm text-failure">
              {error()}
            </p>
          </Show>
          <SettingsSection
            title="Basics"
            description="Details guests see when booking."
          >
            <SettingsCard>
              <div class="flex flex-col gap-5 p-6">
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
                          d.slug === slugify(d.title) ? slugify(title) : d.slug,
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
              </div>
            </SettingsCard>
          </SettingsSection>
          <SettingsSection
            title="Availability"
            description="Choose when this link accepts bookings."
          >
            <SettingsCard>
              <div class="flex flex-col gap-5 p-6">
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
              </div>
            </SettingsCard>
          </SettingsSection>
          <Show when={props.team}>
            <SettingsSection
              title="Hosts"
              description="Select the people who will host this event."
            >
              <SettingsCard>
                <div class="flex flex-col gap-5 p-6">
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
                </div>
              </SettingsCard>
            </SettingsSection>
          </Show>
          <SettingsSection
            title="Limits & buffers"
            description="Leave time between meetings and control how far ahead guests book."
          >
            <SettingsCard>
              <div class="flex flex-col gap-5 p-6">
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
              </div>
            </SettingsCard>
          </SettingsSection>
          <SettingsSection
            title="Booking form"
            description="Collect information before the meeting."
          >
            <SettingsCard>
              <div class="flex flex-col gap-5 p-6">
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
              </div>
            </SettingsCard>
          </SettingsSection>
          <SettingsSection
            title="Confirmation"
            description="Choose how bookings are confirmed."
          >
            <SettingsCard>
              <div class="flex flex-col gap-5 p-6">
                <div class="rounded-lg border border-edge-muted p-4">
                  <p class="font-medium">Automatic confirmation</p>
                  <p class="mt-2 text-sm text-ink-muted">
                    Guests receive a calendar invitation as soon as they book an
                    available time.
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
              </div>
            </SettingsCard>
          </SettingsSection>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="strong" disabled={props.saving}>
            {props.saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </form>
  );
}
