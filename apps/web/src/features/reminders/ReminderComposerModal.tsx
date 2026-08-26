import { toast } from '@core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import {
  type CronParts,
  describeCron,
  isValidCronParts,
  type ScheduleFrequency,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';
import {
  type DateOption,
  useDateSearch,
} from '@core/util/dateSearch/useDateSearch';
import {
  type ListNavActions,
  useListKeyBindings,
} from '@core/util/useListKeyBindings';
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
import { mergeRefs } from '@solid-primitives/refs';
import {
  Button,
  CommandMenuEmptyState,
  CommandMenuHotkeyHint,
  CommandMenuListItem,
  CommandMenuSearchInput,
  CommandMenuShell,
  cn,
  Dialog,
  Hotkey,
} from '@ui';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  onMount,
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
  describeReminderSchedule,
  futureDateOptions,
  isRecurring,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  recurringSchedule,
  reminderDefaultOptions,
  reminderEditOptions,
  reminderEditPatch,
  repeatPartsFromDate,
  repeatPartsFromSchedule,
  resolveEditedDescription,
  resolveReminderDescription,
  resolveStandaloneDescription,
} from './reminder-schedule';

/** The composer's questions, asked in this order. */
type Step = 'description' | 'when' | 'repeat';

/**
 * Asks two questions — what and when — for a reminder, either a new one about
 * an entity or an existing one being edited.
 *
 * The date step is deliberately the date editor reached by `shift+cmd+o`: the
 * same shell, entity chip, search input and `useDateSearch` list. The
 * description step in front of it is optional when creating, and Enter on an
 * empty field falls straight through to the date list.
 *
 * Editing runs the same two steps, prefilled from the reminder. Both keep the
 * create flow's meaning of a blank answer: clearing the description names the
 * reminder after whatever it is about, and the date list leads with keeping the
 * time it already has.
 */
export function ReminderComposerModal() {
  const [dialogRef, setDialogRef] = createSignal<HTMLElement | undefined>();
  const [attach, hotkeyScope] = useHotkeyDOMScope('reminder-composer');
  const [step, setStep] = createSignal<Step>('description');
  const [description, setDescription] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  // The recurrence being built, only meaningful on the repeat step. Seeded when
  // that step opens — from the reminder's own schedule when editing one that
  // already repeats, so its picker starts where the user left it.
  const [repeatParts, setRepeatParts] = createSignal<CronParts>(
    repeatPartsFromDate(new Date())
  );

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
  const keybindings = useListKeyBindings(() => dialogRef());

  const entity = () => reminderComposerState.entity;
  const editing = () => reminderComposerState.editing;
  const standalone = () => reminderComposerState.standalone === true;

  /**
   * The description as it would be stored, for a reminder about nothing.
   *
   * `undefined` means the field has nothing usable in it, which is what both
   * the step's gate and its submit read — one answer, so a description of
   * spaces cannot pass one and fail the other.
   */
  const standaloneDescription = () =>
    resolveStandaloneDescription(description());

  /**
   * Escape steps back to the description before it closes the composer,
   * matching how the command menu treats a sub-scope.
   *
   * @returns whether it stepped back rather than closed.
   */
  const handleEscape = (): boolean => {
    // Unwinds one step at a time, so escape from the repeat picker lands back on
    // the date list rather than throwing the whole reminder away.
    if (step() === 'repeat') {
      setStep('when');
      return true;
    }
    if (step() === 'when') {
      setStep('description');
      return true;
    }
    closeReminderComposer();
    return false;
  };

  /**
   * Open the repeat picker, seeded from whatever is most specific.
   *
   * An existing recurrence first, so changing one starts where it is. Failing
   * that the date the list is currently leading with, so typing "tomorrow 3pm"
   * and then choosing to repeat gives a 3pm recurrence rather than discarding
   * the time that was just asked for.
   */
  const openRepeatStep = (seed?: Date) => {
    const current = editing()?.schedule;
    setRepeatParts(
      current && isRecurring(current)
        ? repeatPartsFromSchedule(current)
        : seed
          ? repeatPartsFromDate(seed)
          : defaultRepeatParts()
    );
    setStep('repeat');
  };

  // Only reachable with focus outside the header input — the hotkey layer skips
  // handlers while an editable is focused. Kobalte's document-level escape
  // handler below covers the usual case; both have to agree.
  const { dispose: disposeHotkey } = registerHotkey({
    hotkey: ['escape'],
    description: 'Go back, or close the reminder composer',
    keyDownHandler: () => {
      handleEscape();
      return true;
    },
    scopeId: hotkeyScope,
  });
  onCleanup(disposeHotkey);

  createEffect(
    on(reminderComposerOpen, () => {
      setStep('description');
      // Prefilled when editing, so the field starts from what the reminder
      // already says rather than asking for it again.
      setDescription(reminderComposerState.editing?.description ?? '');
      setQuery('');
      setSelectedIndex(0);
    })
  );

  /**
   * Whether the description step has been answered well enough to leave.
   *
   * Only a standalone reminder can fail this. Everywhere else the field is
   * optional because there is an entity to name the reminder after, so an
   * empty one is an answer; with nothing to fall back on it is not, and the API
   * rejects it.
   */
  const canAdvanceFromDescription = () =>
    !standalone() || standaloneDescription() !== undefined;

  const advanceFromDescription = () => {
    if (!canAdvanceFromDescription()) return;
    setStep('when');
  };

  // The dialog's Enter binding is a single shared slot, so whichever step is on
  // screen has to claim it or the other step's stale handler stays live. The
  // date step claims it from inside `WhenList`, which owns the list it moves
  // through; the other two have no list, so they claim it here.
  createEffect(
    on(step, (current) => {
      if (current === 'description') {
        keybindings(descriptionStepKeybindings(advanceFromDescription));
      } else if (current === 'repeat') {
        keybindings(listlessStepKeybindings(() => void submitRepeat()));
      }
    })
  );

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
    // Unreachable: the date step cannot be reached without a description. Kept
    // as the last word on it rather than a `!` on the value above.
    if (!resolved) {
      setStep('description');
      return;
    }

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

  const submit = async (date: Date) => {
    const draft = editing();

    // The options are filtered against the time the list was built, so one can
    // slip into the past while the composer sits open. Re-check rather than
    // let the API reject it with an opaque failure. Keeping an existing time is
    // exempt: it sends no schedule, so an overdue reminder stays renamable.
    const keepsCurrentTime = date.getTime() === draft?.remindAt.getTime();
    if (!keepsCurrentTime && date.getTime() <= Date.now()) {
      toast.failure('That time has already passed — pick another');
      return;
    }

    await submitSchedule(onceSchedule(date));
  };

  /**
   * Send the recurrence built on the repeat step.
   *
   * The validity gate lives here rather than at each control that can trigger a
   * submit. It was in two places — the button's `disabled` and the Enter
   * handler — and a gate written twice is one that eventually only holds in one
   * of them. Every path in goes through this, so there is no path that skips
   * it; the button's `disabled` is now an affordance rather than the check.
   *
   * No past-date check: a recurrence has no single instant to have passed, and
   * the backend derives its first firing from the cron itself.
   */
  const submitRepeat = async () => {
    const parts = repeatParts();
    if (!isValidCronParts(parts)) return;
    await submitSchedule(recurringSchedule(parts));
  };

  /**
   * Whether there is a reminder to compose at all.
   *
   * Both targets are cleared on close, so this unmounts the body while the
   * dialog animates shut — otherwise the reset back to the description step
   * would be visible as the date list flicking back to a Continue button.
   */
  const hasTarget = () =>
    entity() !== undefined || editing() !== undefined || standalone();

  // The chip row carries the entity a new reminder is about, and — on the date
  // step — the description typed so far as a way back to it. Editing and
  // standalone have no entity, so the row is only there once something has been
  // typed.
  const showsToolbar = () =>
    entity() !== undefined ||
    (step() !== 'description' && !!description().trim());

  return (
    <Dialog
      open={reminderComposerOpen()}
      onOpenChange={(open) => {
        if (!open) closeReminderComposer();
      }}
      // Kobalte dismisses the whole dialog on escape unless the default is
      // prevented, which would skip the step back.
      onEscapeKeyDown={(event) => {
        if (handleEscape()) event.preventDefault();
      }}
      contentRef={mergeRefs(attach, setDialogRef)}
    >
      <CommandMenuShell depth={2} class="rounded-xl max-h-108 text-sm">
        <CommandMenuShell.Header>
          <span class="pl-2 text-ink-extra-muted/55 pointer-events-none">
            <BellIcon class="size-3" />
          </span>
          <Switch>
            <Match when={step() === 'description'}>
              <StepInput
                placeholder={
                  editing()
                    ? 'Reminder description'
                    : // Not optional for a standalone reminder: there is no
                      // entity to name it after, so this is all it will ever
                      // say.
                      standalone()
                      ? "What's the reminder?"
                      : "What's the reminder? (optional)"
                }
                value={description()}
                onInput={setDescription}
                // Counts UTF-16 code units where the service counts characters,
                // so this only ever stops short of the real limit, never past
                // it. `resolveReminderDescription` applies the exact cap.
                maxLength={REMINDER_DESCRIPTION_MAX_LENGTH}
              />
            </Match>
            <Match when={step() === 'when'}>
              <StepInput
                placeholder="Remind me when?"
                value={query()}
                onInput={setQuery}
              />
            </Match>
            <Match when={step() === 'repeat'}>
              {/* Not an input: the repeat picker is controls, not a query, so
                  the header states what is being answered instead. */}
              <span class="px-2 text-base text-ink-muted">How often?</span>
            </Match>
          </Switch>
        </CommandMenuShell.Header>
        <Show when={hasTarget()}>
          <Show when={showsToolbar()}>
            <CommandMenuShell.Toolbar class="p-3 py-2 border-b-0 gap-2">
              <Show when={entity()}>
                {(target) => (
                  <div class="bg-active border border-edge-muted px-2 py-1 truncate text-xs rounded max-w-[50%]">
                    <InlineEntity entity={target()} />
                  </div>
                )}
              </Show>
              {/* Sized to the space the entity chip leaves rather than to a
                  share of its own, so the pair can never overflow. */}
              <Show when={step() === 'when' && description().trim()}>
                {(typed) => (
                  <button
                    type="button"
                    class="bg-active border border-edge-muted px-2 py-1 truncate text-xs rounded min-w-0 flex-1 text-left text-ink-muted hover:text-ink"
                    title="Edit the description"
                    onClick={() => setStep('description')}
                  >
                    {typed()}
                  </button>
                )}
              </Show>
            </CommandMenuShell.Toolbar>
          </Show>
          <Switch>
            <Match when={step() === 'description'}>
              <DescriptionStep
                onContinue={advanceFromDescription}
                // An affordance, not the check: `advanceFromDescription` holds
                // the gate for every way through this step.
                disabled={!canAdvanceFromDescription()}
              />
            </Match>
            <Match when={step() === 'when'}>
              <CommandMenuShell.Body>
                <WhenList
                  query={query}
                  // Withheld for a recurring reminder. `reminderEditOptions`
                  // turns this into a "Keep current time" date row holding the
                  // next firing — which, activated, submits that single instant
                  // as a one-shot and collapses the series. The `keep` row
                  // carries the recurrence instead, and two adjacent rows both
                  // promising to preserve, one of which destroys, is worse than
                  // either alone.
                  current={() => {
                    const draft = editing();
                    if (!draft) return undefined;
                    return isRecurring(draft.schedule)
                      ? undefined
                      : draft.remindAt;
                  }}
                  currentRecurrence={() => {
                    const schedule = editing()?.schedule;
                    if (!schedule || !isRecurring(schedule)) return undefined;
                    return {
                      schedule,
                      description: describeReminderSchedule(schedule) ?? '',
                    };
                  }}
                  selectedIndex={selectedIndex}
                  setSelectedIndex={setSelectedIndex}
                  onSubmit={(date) => void submit(date)}
                  onKeep={(schedule) => void submitSchedule(schedule)}
                  onRepeat={openRepeatStep}
                  setKeybindings={keybindings}
                />
              </CommandMenuShell.Body>
            </Match>
            <Match when={step() === 'repeat'}>
              <CommandMenuShell.Body>
                <RepeatStep
                  parts={repeatParts}
                  setParts={setRepeatParts}
                  onSubmit={() => void submitRepeat()}
                />
              </CommandMenuShell.Body>
            </Match>
          </Switch>
        </Show>
      </CommandMenuShell>
    </Dialog>
  );
}

/**
 * The dialog's shared list bindings for a step that has no list.
 *
 * The arrows go inert and Enter does the step's one action, so a step made of
 * controls rather than rows still answers the key everything else answers.
 */
function listlessStepKeybindings(select: VoidFunction): ListNavActions {
  return { next: () => {}, previous: () => {}, select };
}

/**
 * What the description step does with those bindings: Enter is the
 * skip-through, advancing whether or not anything was typed.
 */
function descriptionStepKeybindings(advance: VoidFunction): ListNavActions {
  return listlessStepKeybindings(advance);
}

/**
 * The header input for one step.
 *
 * Focused on mount rather than with `autofocus`, which only fires for the step
 * that happens to be on screen when the dialog opens — moving between steps
 * remounts the input inside an already-open dialog.
 */
function StepInput(props: {
  placeholder: string;
  value: string;
  onInput: (value: string) => void;
  maxLength?: number;
}) {
  let ref: HTMLInputElement | undefined;

  onMount(() => {
    ref?.focus();
    // Caret at the end: stepping back to a field that already has text should
    // continue it, not land in front of it.
    const end = ref?.value.length ?? 0;
    ref?.setSelectionRange(end, end);
  });

  return (
    <CommandMenuSearchInput
      ref={ref}
      class="text-base"
      placeholder={props.placeholder}
      value={props.value}
      maxLength={props.maxLength}
      onInput={(e) => props.onInput(e.currentTarget.value)}
    />
  );
}

/**
 * The optional first step: name the reminder, or press Enter past it.
 *
 * When creating, the entity name a blank field falls back to is never
 * pre-filled, so skipping stays a single keystroke instead of a select-all and
 * delete. When editing it necessarily is pre-filled — clearing it back out asks
 * for that same fallback.
 *
 * Not optional for a standalone reminder, which has no fallback: `disabled`
 * says so, and the caller's gate is what enforces it.
 */
function DescriptionStep(props: {
  onContinue: VoidFunction;
  disabled?: boolean;
}) {
  return (
    <CommandMenuShell.Footer class="gap-2 border-t-0 py-3">
      <CommandMenuHotkeyHint
        hotkey={<Hotkey shortcut="escape" />}
        label="Cancel"
      />
      <Button
        variant="accent"
        size="sm"
        depth={3}
        class="ml-auto gap-3 rounded-lg border-0"
        disabled={props.disabled}
        onClick={props.onContinue}
      >
        Continue
        <Hotkey shortcut="enter" theme="current" />
      </Button>
    </CommandMenuShell.Footer>
  );
}

/**
 * One row of the date list: a date to fire once at, or the way through to the
 * repeat picker.
 *
 * Modelled as a union rather than appending a fake `DateOption` so the repeat
 * row cannot be mistaken for a date and submitted as one.
 */
type WhenRow =
  | { kind: 'date'; option: DateOption }
  /**
   * Leave an existing recurring schedule exactly as it is.
   *
   * Its own kind rather than a relabelled date row. A recurring reminder's next
   * firing is one instant out of a series, so activating it as a date would
   * submit that instant as a one-shot — quietly collapsing the whole series
   * into a single day, from a row that says "Keep repeating".
   */
  | { kind: 'keep'; schedule: ReminderSchedule; detail: string }
  | { kind: 'repeat'; label: string; detail?: string };

function WhenList(props: {
  query: () => string;
  /** The firing an edited reminder already has, offered as "Keep current time". */
  current: () => Date | undefined;
  /** An edited reminder's existing recurrence, when it has one. */
  currentRecurrence: () =>
    | { schedule: ReminderSchedule; description: string }
    | undefined;
  selectedIndex: () => number;
  setSelectedIndex: (next: number | ((prev: number) => number)) => void;
  onSubmit: (date: Date) => void;
  /** Submit an existing recurring schedule unchanged. */
  onKeep: (schedule: ReminderSchedule) => void;
  onRepeat: (seed?: Date) => void;
  setKeybindings: (actions: {
    next: VoidFunction;
    previous: VoidFunction;
    select: () => void;
  }) => void;
}) {
  const rawOptions = useDateSearch({
    query: props.query,
    defaultTime: REMINDER_DEFAULT_TIME,
    showTimeInResults: true,
  });

  const dateOptions = createMemo(() => {
    const now = new Date();
    // The resting list is reminder-specific; typing hands off to the shared
    // date search. Either way a reminder must fire in the future.
    if (!props.query().trim()) {
      const current = props.current();
      return current
        ? reminderEditOptions(current, now)
        : reminderDefaultOptions(now);
    }
    return futureDateOptions(rawOptions(), now);
  });

  const rows = createMemo<WhenRow[]>(() => {
    const existing = props.currentRecurrence();
    const typing = !!props.query().trim();

    // A reminder that already repeats has no single "current time" to keep —
    // its schedule is the recurrence — so leading with a row that hands back
    // that schedule untouched beats offering its next firing as if that were
    // the whole story. Dropped while typing: a query is a request for a
    // different time, and the keep row would sit above the answer.
    const keep: WhenRow[] =
      existing && !typing
        ? [
            {
              kind: 'keep',
              schedule: existing.schedule,
              detail: existing.description,
            },
          ]
        : [];

    const dates: WhenRow[] = dateOptions().map((option) => ({
      kind: 'date',
      option,
    }));

    // Always last, so it never displaces the date someone is reaching for, and
    // Enter on a date still creates a one-shot in two keystrokes.
    return [
      ...keep,
      ...dates,
      {
        kind: 'repeat',
        label: existing ? 'Change repeat…' : 'Repeat…',
        detail: existing?.description,
      },
    ];
  });

  // The date the selection last rested on, which is what a recurrence started
  // from here should inherit. Arrowing down to "In 2 hours" and carrying on to
  // "Repeat…" means that time, not whichever date happens to head the list.
  const [seedDate, setSeedDate] = createSignal<Date | undefined>();
  createEffect(() => {
    const row = rows()[props.selectedIndex()];
    if (row?.kind === 'date') setSeedDate(row.option.date);
  });

  const activate = (row: WhenRow) => {
    // Falls back to the leading option, which is what a typed query resolves
    // to — so "tomorrow 3pm" then Repeat still gives a 3pm recurrence even
    // without having moved the selection onto it.
    if (row.kind === 'repeat') {
      return props.onRepeat(seedDate() ?? dateOptions()[0]?.date);
    }
    if (row.kind === 'keep') return props.onKeep(row.schedule);
    props.onSubmit(row.option.date);
  };

  createEffect(
    on(rows, (current) => {
      props.setSelectedIndex(
        Math.min(props.selectedIndex(), Math.max(current.length - 1, 0))
      );
    })
  );

  props.setKeybindings({
    next: () => {
      const len = rows().length;
      if (len === 0) return;
      props.setSelectedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = rows().length;
      if (len === 0) return;
      props.setSelectedIndex((prev) => (prev - 1 + len) % len);
    },
    select: () => {
      const selected = rows()[props.selectedIndex()];
      if (selected) activate(selected);
    },
  });

  createEffect(() => {
    const index = props.selectedIndex();
    document
      .getElementById(`reminder-date-option-${index}`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  const isSelected = createSelector(props.selectedIndex);

  return (
    <>
      <div class="p-2 max-h-54 overflow-y-auto overflow-x-hidden scrollbar-hidden">
        <Show
          when={dateOptions().length > 0 || !props.query().trim()}
          fallback={
            <CommandMenuEmptyState>
              No future dates match "{props.query()}"
            </CommandMenuEmptyState>
          }
        >
          <For each={rows()}>
            {(row, index) => (
              <CommandMenuListItem
                id={`reminder-date-option-${index()}`}
                selected={isSelected(index())}
                onClick={() => activate(row)}
                onMouseMove={() => props.setSelectedIndex(index())}
                class="scroll-m-2"
              >
                <div class="flex-1 text-left">
                  <p class="text-sm font-medium">
                    {row.kind === 'date'
                      ? row.option.displayText
                      : row.kind === 'keep'
                        ? 'Keep repeating'
                        : row.label}
                  </p>
                </div>
                <span class="text-xs text-ink-muted">
                  {row.kind === 'date' ? row.option.secondaryText : row.detail}
                </span>
              </CommandMenuListItem>
            )}
          </For>
        </Show>
      </div>

      <div class="p-4 border-t border-edge-muted flex items-center gap-4">
        <div class="text-xs text-ink-muted">
          <span>Use queries like </span>
          <code class="bg-active px-1">3d</code>,{' '}
          <code class="bg-active px-1">1w</code>,{' '}
          <code class="bg-active px-1">feb 17</code>,{' '}
          <code class="bg-active px-1">tomorrow</code>, or{' '}
          <code class="bg-active px-1">tomorrow 3pm</code>
        </div>
        <CommandMenuHotkeyHint
          class="ml-auto shrink-0 text-xs text-ink-extra-muted/80"
          hotkey={<Hotkey shortcut="escape" />}
          label="Back"
        />
      </div>
    </>
  );
}

/**
 * The recurrences the picker offers, in ascending period.
 *
 * No daily entry: weekly with every day ticked says the same thing, and the
 * summary reads it back as "every day".
 */
const REPEAT_FREQUENCIES: Array<{ value: ScheduleFrequency; label: string }> = [
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
];

/**
 * Builds a recurrence: how often, on which days, at what time.
 *
 * Deliberately the same shape as the automation schedule editor — frequency,
 * then the one control that frequency needs, then a time — because it is the
 * same question, and someone who has set up an automation should not have to
 * learn a second way to say "every weekday at 9".
 */
function RepeatStep(props: {
  parts: () => CronParts;
  setParts: (next: CronParts) => void;
  onSubmit: VoidFunction;
}) {
  const update = (patch: Partial<CronParts>) =>
    props.setParts({ ...props.parts(), ...patch });

  const toggleDay = (value: string) => {
    const days = props.parts().daysOfWeek;
    // Never empty: an empty selection builds an every-day cron, which is not
    // what unticking your last day is asking for.
    const next = days.includes(value)
      ? days.filter((day) => day !== value)
      : [...days, value];
    if (next.length > 0) update({ daysOfWeek: next });
  };

  const summary = () => describeCron(props.parts());
  // Gates submit on everything `buildCron` would otherwise substitute a
  // fallback for — an out-of-range time, a day-of-month like 99 — so the
  // schedule that gets stored is the one the summary above describes.
  const isValid = () => isValidCronParts(props.parts());

  return (
    <>
      <div class="p-3 space-y-3 max-h-72 overflow-y-auto scrollbar-hidden">
        <div class="flex gap-1">
          <For each={REPEAT_FREQUENCIES}>
            {(option) => (
              <button
                type="button"
                class={cn(
                  'flex-1 rounded px-2 py-1.5 text-sm border',
                  props.parts().frequency === option.value
                    ? 'bg-active border-edge text-ink'
                    : 'border-edge-muted text-ink-muted hover:text-ink'
                )}
                onClick={() => update({ frequency: option.value })}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>

        <Show when={props.parts().frequency === 'week'}>
          <div class="flex gap-1">
            <For each={WEEKDAY_OPTIONS}>
              {(day) => (
                <button
                  type="button"
                  class={cn(
                    'flex-1 rounded px-1 py-1.5 text-xs border',
                    props.parts().daysOfWeek.includes(day.value)
                      ? 'bg-active border-edge text-ink'
                      : 'border-edge-muted text-ink-muted hover:text-ink'
                  )}
                  aria-pressed={props.parts().daysOfWeek.includes(day.value)}
                  onClick={() => toggleDay(day.value)}
                >
                  {day.label}
                </button>
              )}
            </For>
          </div>
        </Show>

        <div class="flex items-center gap-2">
          <Show when={props.parts().frequency === 'month'}>
            <label class="flex items-center gap-2 text-sm text-ink-muted">
              Day
              <input
                type="number"
                min="1"
                max="31"
                class="w-16 rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent/20"
                value={props.parts().dayOfMonth}
                onInput={(e) => update({ dayOfMonth: e.currentTarget.value })}
              />
            </label>
          </Show>
          <label class="flex items-center gap-2 text-sm text-ink-muted">
            At
            <input
              type="time"
              class="rounded-sm border border-edge-muted bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-accent/20"
              value={props.parts().time}
              onInput={(e) => update({ time: e.currentTarget.value })}
            />
          </label>
        </div>
      </div>

      <CommandMenuShell.Footer class="gap-3 py-3">
        <span class="text-xs text-ink-muted truncate">{summary()}</span>
        <Button
          variant="accent"
          size="sm"
          depth={3}
          class="ml-auto gap-3 rounded-lg border-0"
          disabled={!isValid()}
          onClick={props.onSubmit}
        >
          Set reminder
          <Hotkey shortcut="enter" theme="current" />
        </Button>
      </CommandMenuShell.Footer>
    </>
  );
}
