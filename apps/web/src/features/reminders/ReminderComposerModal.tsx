import { ItemPreview } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import {
  type CronParts,
  describeCron,
  isValidCronParts,
  type ScheduleFrequency,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';
import { type EntityData, InlineEntity } from '@entity';
import BellIcon from '@phosphor/bell-simple.svg';
import {
  reminderSoupPatch,
  reminderTarget,
  useCreateReminderMutation,
  useUpdateReminderMutation,
} from '@queries/reminders/reminders';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/cache';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { Button, cn, Dialog, Panel } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import {
  closeReminderComposer,
  type ReminderDraft,
  reminderComposerOpen,
  reminderComposerState,
  takeReminderCreatedHandler,
} from './reminder-composer';
import {
  defaultRepeatParts,
  isRecurring,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  recurringSchedule,
  reminderEditPatch,
  repeatPartsFromDate,
  repeatPartsFromSchedule,
  resolveEditedDescription,
  resolveReminderDescription,
  resolveStandaloneDescription,
} from './reminder-schedule';

/** How a reminder repeats: not at all (a one-shot), or on a weekly/monthly cron. */
type RepeatKind = 'once' | ScheduleFrequency;

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` for a date in local time — the value a `<input type="date">` takes. */
function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `HH:MM` for a date in local time — the value a `<input type="time">` takes. */
function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Whether two picker recurrences say the same thing, ignoring day order. */
function samePartsShape(a: CronParts, b: CronParts): boolean {
  return (
    a.frequency === b.frequency &&
    a.time === b.time &&
    a.dayOfMonth === b.dayOfMonth &&
    a.daysOfWeek.length === b.daysOfWeek.length &&
    a.daysOfWeek.every((day) => b.daysOfWeek.includes(day))
  );
}

/**
 * Asks two questions — what and when — for a reminder, in one panel: a new one
 * about an entity, a new one about nothing, or an existing one being edited.
 *
 * The title and the schedule sit together the way the calendar event editor
 * lays them out, so editing either is one panel and one Save rather than a walk
 * through separate steps. A blank title keeps its create-flow meaning — name the
 * reminder after whatever it is about — and an untouched schedule on an existing
 * reminder is left exactly as it is, so a rename never reschedules it.
 */
export function ReminderComposerModal() {
  const [description, setDescription] = createSignal('');
  const [repeat, setRepeat] = createSignal<RepeatKind>('once');
  const [onceDate, setOnceDate] = createSignal('');
  const [onceTime, setOnceTime] = createSignal('');
  // The recurrence being built, only meaningful when `repeat` is not 'once'.
  const [repeatParts, setRepeatParts] = createSignal<CronParts>(
    defaultRepeatParts()
  );

  // What the schedule controls were seeded to, so an untouched edit can be told
  // from a real change without depending on second-level precision the pickers
  // do not carry.
  const [initialRepeat, setInitialRepeat] = createSignal<RepeatKind>('once');
  const [initialOnceDate, setInitialOnceDate] = createSignal('');
  const [initialOnceTime, setInitialOnceTime] = createSignal('');
  const [initialParts, setInitialParts] = createSignal<CronParts>(
    defaultRepeatParts()
  );

  let titleRef: HTMLInputElement | undefined;

  // Nothing else brings a new reminder into Soup: the service emits no
  // websocket event on create (its only outbound signals are the dispatch
  // queue and the notification when a reminder fires), so without this fetch
  // the Scheduled/Pending lists only learn about the reminder on their next
  // full fetch.
  const createReminder = useCreateReminderMutation({
    onSuccess: (reminder) => void refetchSoupEntity(reminder.id, 'reminder'),
  });
  // Soup rows come from the normalized soup cache, not the reminders queries,
  // so the mutation's own invalidation leaves an edited row reading its old
  // description and firing time until a reload. Applying the response is not an
  // optimistic guess — `nextRunAt` is derived server-side from the schedule,
  // and this is the value it derived, which is why it lands on success rather
  // than in `onMutate`.
  const updateReminder = useUpdateReminderMutation({
    onSuccess: (reminder) =>
      optimisticUpdateSoupEntity(
        reminderSoupPatch(
          reminder,
          getSoupEntityById(reminder.id)?.frecency_score
        )
      ),
  });

  const entity = () => reminderComposerState.entity;
  const editing = () => reminderComposerState.editing;
  const standalone = () => reminderComposerState.standalone === true;

  /**
   * The description as it would be stored, for a reminder about nothing.
   *
   * `undefined` means the field has nothing usable in it, which is what both
   * the Save gate and the standalone submit read — one answer, so a description
   * of spaces cannot pass one and fail the other.
   */
  const standaloneDescription = () =>
    resolveStandaloneDescription(description());

  const onceDateTime = () => new Date(`${onceDate()}T${onceTime()}`);

  /** Whether the schedule controls still hold exactly what they were seeded to. */
  const scheduleUntouched = () => {
    if (repeat() !== initialRepeat()) return false;
    return repeat() === 'once'
      ? onceDate() === initialOnceDate() && onceTime() === initialOnceTime()
      : samePartsShape(repeatParts(), initialParts());
  };

  // Seed every field from whatever the composer was opened for.
  createEffect(
    on(reminderComposerOpen, () => {
      const draft = reminderComposerState.editing;
      setDescription(draft?.description ?? '');

      const now = new Date();
      const onceSeed =
        draft && !isRecurring(draft.schedule) ? draft.remindAt : atDefault(now);
      const recurringSeed =
        draft && isRecurring(draft.schedule)
          ? repeatPartsFromSchedule(draft.schedule)
          : repeatPartsFromDate(onceSeed);
      const kind: RepeatKind =
        draft && isRecurring(draft.schedule) ? recurringSeed.frequency : 'once';

      setRepeat(kind);
      setOnceDate(toDateInput(onceSeed));
      setOnceTime(toTimeInput(onceSeed));
      setRepeatParts(recurringSeed);

      setInitialRepeat(kind);
      setInitialOnceDate(toDateInput(onceSeed));
      setInitialOnceTime(toTimeInput(onceSeed));
      setInitialParts(recurringSeed);
    })
  );

  const setRepeatKind = (kind: RepeatKind) => {
    setRepeat(kind);
    if (kind !== 'once') {
      setRepeatParts((parts) => ({ ...parts, frequency: kind }));
    }
  };

  const updateParts = (patch: Partial<CronParts>) =>
    setRepeatParts((parts) => ({ ...parts, ...patch }));

  const toggleDay = (value: string) => {
    const days = repeatParts().daysOfWeek;
    // Never empty: an empty selection builds an every-day cron, which is not
    // what unticking your last day is asking for.
    const next = days.includes(value)
      ? days.filter((day) => day !== value)
      : [...days, value];
    if (next.length > 0) updateParts({ daysOfWeek: next });
  };

  const submitCreate = async (
    schedule: ReminderSchedule,
    target: EntityData
  ) => {
    const resolved = resolveReminderDescription(description(), target);
    const attachTo = reminderTarget(target);
    // Taken before the close, which clears it.
    const onCreated = takeReminderCreatedHandler();
    closeReminderComposer();

    try {
      await createReminder.mutateAsync({
        description: resolved,
        schedule,
        // Both or neither: the API rejects one without the other.
        ...(attachTo ?? undefined),
      });
      toast.success('Reminder set');
    } catch {
      toast.failure('Failed to create reminder');
      return;
    }

    // Whatever the invoking surface does with its row now that the reminder
    // will bring it back — marking it done, in every soup list. Runs only once
    // the reminder exists, so a failed create leaves the row alone.
    await onCreated?.();
  };

  /**
   * Create a reminder attached to nothing.
   *
   * Sends no entity at all rather than an empty one — the API rejects an
   * `entityType` without an `entityId` — and the description is whatever was
   * typed, since there is nothing to derive one from.
   */
  const submitStandalone = async (schedule: ReminderSchedule) => {
    const resolved = standaloneDescription();
    // Unreachable: Save is disabled without a description. Kept as the last word
    // on it rather than a `!` on the value above.
    if (!resolved) return;

    // Taken before the close, which clears it. Nothing passes one today, but
    // taking it is what keeps a handler from leaking into the next open.
    const onCreated = takeReminderCreatedHandler();
    closeReminderComposer();

    try {
      await createReminder.mutateAsync({ description: resolved, schedule });
      toast.success('Reminder set');
    } catch {
      toast.failure('Failed to create reminder');
      return;
    }

    await onCreated?.();
  };

  const submitEdit = async (
    schedule: ReminderSchedule,
    draft: ReminderDraft
  ) => {
    const patch = reminderEditPatch(draft, {
      // Blank means the same here as it does when creating: name it after
      // whatever it is about.
      description: resolveEditedDescription(
        description(),
        draft.description,
        draft.fallbackDescription
      ),
      schedule,
    });
    closeReminderComposer();

    // Neither answer moved. There is nothing to send — and an empty patch is
    // rejected as having no fields to update.
    if (!patch) return;

    try {
      await updateReminder.mutateAsync({ id: draft.id, patch });
      toast.success('Reminder updated');
    } catch {
      toast.failure('Failed to update reminder');
    }
  };

  /** Send whichever kind of schedule the user landed on. */
  const submitSchedule = async (schedule: ReminderSchedule) => {
    const draft = editing();
    if (draft) return await submitEdit(schedule, draft);

    const target = entity();
    if (target) return await submitCreate(schedule, target);

    if (standalone()) return await submitStandalone(schedule);
  };

  const save = async () => {
    const draft = editing();

    // Editing without touching the schedule keeps the stored one verbatim, so
    // `reminderEditPatch` omits it — which is what lets an overdue reminder be
    // renamed, and keeps a description-only edit from clearing its done flag.
    if (draft && scheduleUntouched()) {
      await submitSchedule(draft.schedule);
      return;
    }

    if (repeat() === 'once') {
      const date = onceDateTime();
      if (Number.isNaN(date.getTime())) return;
      // The controls can sit open long enough for a picked time to slip into the
      // past; re-check rather than let the API reject it with an opaque failure.
      if (date.getTime() <= Date.now()) {
        toast.failure('That time has already passed — pick another');
        return;
      }
      await submitSchedule(onceSchedule(date));
      return;
    }

    const parts = repeatParts();
    // No past-date check: a recurrence has no single instant to have passed, and
    // the backend derives its first firing from the cron itself.
    if (!isValidCronParts(parts)) return;
    await submitSchedule(recurringSchedule(parts));
  };

  /**
   * Whether Save may fire. A standalone reminder needs a description; every
   * schedule needs to be one the backend will accept. The past-date check lives
   * in `save` (as a toast) rather than here, so the button reads as an
   * affordance rather than blinking disabled as the clock passes a chosen time.
   */
  const canSave = () => {
    if (standalone() && standaloneDescription() === undefined) return false;
    return repeat() === 'once'
      ? !Number.isNaN(onceDateTime().getTime())
      : isValidCronParts(repeatParts());
  };

  /**
   * Whether there is a reminder to compose at all.
   *
   * Both targets are cleared on close, so this unmounts the body while the
   * dialog animates shut.
   */
  const hasTarget = () =>
    entity() !== undefined || editing() !== undefined || standalone();

  const titlePlaceholder = () =>
    editing()
      ? 'Reminder description'
      : // Not optional for a standalone reminder: there is no entity to name it
        // after, so this is all it will ever say.
        standalone()
        ? "What's the reminder?"
        : "What's the reminder? (optional)";

  return (
    <Dialog
      open={reminderComposerOpen()}
      onOpenChange={(open) => {
        if (!open) closeReminderComposer();
      }}
      // Land in the title rather than on the referenced-entity chip, which is
      // the first tabbable when a reminder points at something.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef?.focus();
      }}
      position="center"
      class="w-[28rem]"
    >
      <Panel depth={2} class="rounded-xl">
        <Panel.Header class="px-4">
          <Dialog.Title class="flex items-center gap-2 text-sm font-semibold text-ink">
            <BellIcon class="size-3.5 text-ink-muted" />
            {editing() ? 'Edit reminder' : 'New reminder'}
          </Dialog.Title>
        </Panel.Header>
        <Show when={hasTarget()}>
          <Panel.Body class="p-4 font-sans">
            <form
              class="flex flex-col gap-4 text-sm"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              {/* What the reminder is about, when it is about something. Create
                  shows the entity it was invoked on; editing links what the row
                  points at, so it stays reachable now that a row click opens
                  this panel rather than that entity. */}
              <Show when={entity()}>
                {(target) => (
                  <div class="flex">
                    <div class="max-w-full truncate rounded border border-edge-muted bg-active px-2 py-1 text-xs">
                      <InlineEntity entity={target()} />
                    </div>
                  </div>
                )}
              </Show>
              <Show when={editing()?.referencedEntity}>
                {(reference) => (
                  <div class="flex">
                    <div class="max-w-full truncate rounded border border-edge-muted bg-active px-2 py-1 text-xs">
                      <ItemPreview
                        id={reference().id}
                        type={reference().type}
                      />
                    </div>
                  </div>
                )}
              </Show>

              <input
                ref={titleRef}
                type="text"
                value={description()}
                onInput={(event) => setDescription(event.currentTarget.value)}
                placeholder={titlePlaceholder()}
                aria-label="Reminder description"
                // Counts UTF-16 code units where the service counts characters,
                // so this only ever stops short of the real limit, never past
                // it. The description resolvers apply the exact cap.
                maxLength={REMINDER_DESCRIPTION_MAX_LENGTH}
                class="w-full rounded-md border border-edge-muted bg-surface px-2 py-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-accent"
              />

              <div class="flex flex-col gap-2">
                <span class="text-xs font-medium text-ink-muted">Repeat</span>
                <div class="flex gap-1">
                  <For
                    each={
                      [
                        { value: 'once', label: 'Does not repeat' },
                        { value: 'week', label: 'Weekly' },
                        { value: 'month', label: 'Monthly' },
                      ] as const
                    }
                  >
                    {(option) => (
                      <button
                        type="button"
                        class={cn(
                          'flex-1 rounded border px-2 py-1.5 text-xs',
                          repeat() === option.value
                            ? 'border-edge bg-active text-ink'
                            : 'border-edge-muted text-ink-muted hover:text-ink'
                        )}
                        onClick={() => setRepeatKind(option.value)}
                      >
                        {option.label}
                      </button>
                    )}
                  </For>
                </div>
              </div>

              <Switch>
                <Match when={repeat() === 'once'}>
                  <div class="flex items-center gap-2">
                    <input
                      type="date"
                      aria-label="Date"
                      value={onceDate()}
                      onInput={(event) =>
                        setOnceDate(event.currentTarget.value)
                      }
                      class="rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                    />
                    <input
                      type="time"
                      aria-label="Time"
                      value={onceTime()}
                      onInput={(event) =>
                        setOnceTime(event.currentTarget.value)
                      }
                      class="rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                    />
                  </div>
                </Match>
                <Match when={repeat() === 'week'}>
                  <div class="flex flex-col gap-3">
                    <div class="flex gap-1">
                      <For each={WEEKDAY_OPTIONS}>
                        {(day) => (
                          <button
                            type="button"
                            class={cn(
                              'flex-1 rounded border px-1 py-1.5 text-xs',
                              repeatParts().daysOfWeek.includes(day.value)
                                ? 'border-edge bg-active text-ink'
                                : 'border-edge-muted text-ink-muted hover:text-ink'
                            )}
                            aria-pressed={repeatParts().daysOfWeek.includes(
                              day.value
                            )}
                            onClick={() => toggleDay(day.value)}
                          >
                            {day.label}
                          </button>
                        )}
                      </For>
                    </div>
                    <TimeField
                      value={repeatParts().time}
                      onChange={(time) => updateParts({ time })}
                    />
                  </div>
                </Match>
                <Match when={repeat() === 'month'}>
                  <div class="flex items-center gap-3">
                    <label class="flex items-center gap-2 text-sm text-ink-muted">
                      Day
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={repeatParts().dayOfMonth}
                        onInput={(event) =>
                          updateParts({ dayOfMonth: event.currentTarget.value })
                        }
                        class="w-16 rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
                      />
                    </label>
                    <TimeField
                      value={repeatParts().time}
                      onChange={(time) => updateParts({ time })}
                    />
                  </div>
                </Match>
              </Switch>

              <Show when={repeat() !== 'once'}>
                <span class="truncate text-xs text-ink-muted">
                  {describeCron(repeatParts())}
                </span>
              </Show>

              <div class="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="rounded-lg"
                  onClick={closeReminderComposer}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="accent"
                  size="sm"
                  depth={3}
                  class="rounded-lg border-0"
                  disabled={!canSave()}
                >
                  {editing() ? 'Save' : 'Set reminder'}
                </Button>
              </div>
            </form>
          </Panel.Body>
        </Show>
      </Panel>
    </Dialog>
  );
}

/** A time-of-day field for the recurring schedule. `At HH:MM`. */
function TimeField(props: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label class="flex items-center gap-2 text-sm text-ink-muted">
      At
      <input
        type="time"
        value={props.value}
        onInput={(event) => props.onChange(event.currentTarget.value)}
        class="rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent"
      />
    </label>
  );
}

/** The same instant, at `REMINDER_DEFAULT_TIME`, one day out — the create default. */
function atDefault(now: Date): Date {
  const result = new Date(now);
  result.setDate(result.getDate() + 1);
  result.setHours(
    REMINDER_DEFAULT_TIME.hours,
    REMINDER_DEFAULT_TIME.minutes,
    0,
    0
  );
  return result;
}
