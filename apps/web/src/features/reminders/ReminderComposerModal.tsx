import { toast } from '@core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
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
import { mergeRefs } from '@solid-primitives/refs';
import {
  Button,
  CommandMenuEmptyState,
  CommandMenuHotkeyHint,
  CommandMenuListItem,
  CommandMenuSearchInput,
  CommandMenuShell,
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
  formatReminderWhen,
  futureDateOptions,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  reminderDefaultOptions,
  reminderEditOptions,
  reminderEditPatch,
  resolveEditedDescription,
  resolveReminderDescription,
} from './reminder-schedule';

/** The composer's two questions, asked in this order. */
type Step = 'description' | 'when';

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

  /**
   * Escape steps back to the description before it closes the composer,
   * matching how the command menu treats a sub-scope.
   *
   * @returns whether it stepped back rather than closed.
   */
  const handleEscape = (): boolean => {
    if (step() === 'when') {
      setStep('description');
      return true;
    }
    closeReminderComposer();
    return false;
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

  const advanceFromDescription = () => setStep('when');

  // The dialog's Enter binding is a single shared slot, so whichever step is on
  // screen has to claim it or the other step's stale handler stays live.
  createEffect(
    on(step, (current) => {
      if (current !== 'description') return;
      keybindings(descriptionStepKeybindings(advanceFromDescription));
    })
  );

  const submitCreate = async (date: Date, target: EntityData) => {
    const resolved = resolveReminderDescription(description(), target);
    const attachTo = reminderTarget(target);
    // Taken before the close, which clears it.
    const onCreated = takeReminderCreatedHandler();
    closeReminderComposer();

    try {
      await createReminder.mutateAsync({
        description: resolved,
        schedule: onceSchedule(date),
        // Both or neither: the API rejects one without the other.
        ...(attachTo ?? undefined),
      });
      toast.success(`Reminder set for ${formatReminderWhen(date)}`);
    } catch {
      toast.failure('Failed to create reminder');
      return;
    }

    // Whatever the invoking surface does with its row now that the reminder
    // will bring it back — marking it done, in every soup list. Runs only once
    // the reminder exists, so a failed create leaves the row alone.
    await onCreated?.();
  };

  const submitEdit = async (date: Date, draft: ReminderDraft) => {
    const patch = reminderEditPatch(draft, {
      // Blank means the same here as it does when creating: name it after
      // whatever it is about.
      description: resolveEditedDescription(
        description(),
        draft.description,
        draft.fallbackDescription
      ),
      remindAt: date,
    });
    closeReminderComposer();

    // Neither answer moved. There is nothing to send — and an empty patch is
    // rejected as having no fields to update.
    if (!patch) return;

    try {
      await updateReminder.mutateAsync({ id: draft.id, patch });
      toast.success(
        patch.schedule
          ? `Reminder set for ${formatReminderWhen(date)}`
          : 'Reminder updated'
      );
    } catch {
      toast.failure('Failed to update reminder');
    }
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

    if (draft) return await submitEdit(date, draft);

    const target = entity();
    if (target) return await submitCreate(date, target);
  };

  /**
   * Whether there is a reminder to compose at all.
   *
   * Both targets are cleared on close, so this unmounts the body while the
   * dialog animates shut — otherwise the reset back to the description step
   * would be visible as the date list flicking back to a Continue button.
   */
  const hasTarget = () => entity() !== undefined || editing() !== undefined;

  // The chip row carries the entity a new reminder is about, and — on the date
  // step — the description typed so far as a way back to it. Editing has no
  // entity, so the row is only there once something has been typed.
  const showsToolbar = () =>
    entity() !== undefined || (step() === 'when' && !!description().trim());

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
              <DescriptionStep onContinue={advanceFromDescription} />
            </Match>
            <Match when={step() === 'when'}>
              <CommandMenuShell.Body>
                <WhenList
                  query={query}
                  current={() => editing()?.remindAt}
                  selectedIndex={selectedIndex}
                  setSelectedIndex={setSelectedIndex}
                  onSubmit={(date) => void submit(date)}
                  setKeybindings={keybindings}
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
 * What the description step does with the dialog's shared list bindings.
 *
 * There is no list to move through, so the arrows are inert and Enter is the
 * skip-through: it advances whether or not anything was typed, subject to the
 * step's own check.
 */
function descriptionStepKeybindings(advance: VoidFunction): ListNavActions {
  return { next: () => {}, previous: () => {}, select: advance };
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
 */
function DescriptionStep(props: { onContinue: VoidFunction }) {
  return (
    <CommandMenuShell.Footer class="gap-2 border-t-0 py-3">
      <CommandMenuHotkeyHint
        hotkey={<Hotkey shortcut="escape" />}
        label="Cancel"
      />
      <Button
        variant="active"
        size="sm"
        depth={3}
        class="ml-auto gap-3 rounded-lg border-0"
        onClick={props.onContinue}
      >
        Continue
        <Hotkey shortcut="enter" theme="current" />
      </Button>
    </CommandMenuShell.Footer>
  );
}

function WhenList(props: {
  query: () => string;
  /** The firing an edited reminder already has, offered as "Keep current time". */
  current: () => Date | undefined;
  selectedIndex: () => number;
  setSelectedIndex: (next: number | ((prev: number) => number)) => void;
  onSubmit: (date: Date) => void;
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

  createEffect(
    on(dateOptions, (options) => {
      if (options.length === 0) {
        props.setSelectedIndex(0);
      } else {
        props.setSelectedIndex(
          Math.min(props.selectedIndex(), options.length - 1)
        );
      }
    })
  );

  props.setKeybindings({
    next: () => {
      const len = dateOptions().length;
      if (len === 0) return;
      props.setSelectedIndex((prev) => (prev + 1) % len);
    },
    previous: () => {
      const len = dateOptions().length;
      if (len === 0) return;
      props.setSelectedIndex((prev) => (prev - 1 + len) % len);
    },
    select: () => {
      const selected = dateOptions()[props.selectedIndex()];
      if (selected) props.onSubmit(selected.date);
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
          when={dateOptions().length > 0}
          fallback={
            <Show
              when={props.query().trim()}
              fallback={
                <CommandMenuEmptyState>
                  Enter a date, time or duration
                </CommandMenuEmptyState>
              }
            >
              <CommandMenuEmptyState>
                No future dates match "{props.query()}"
              </CommandMenuEmptyState>
            </Show>
          }
        >
          <For each={dateOptions()}>
            {(option, index) => (
              <CommandMenuListItem
                id={`reminder-date-option-${index()}`}
                selected={isSelected(index())}
                onClick={() => props.onSubmit(option.date)}
                onMouseMove={() => props.setSelectedIndex(index())}
                class="scroll-m-2"
              >
                <div class="flex-1 text-left">
                  <p class="text-sm font-medium">{option.displayText}</p>
                </div>
                <span class="text-xs text-ink-muted">
                  {option.secondaryText}
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
