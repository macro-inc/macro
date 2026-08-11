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
  reminderTarget,
  useCreateReminderMutation,
} from '@queries/reminders/reminders';
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
  reminderComposerOpen,
  reminderComposerState,
} from './reminder-composer';
import {
  formatReminderWhen,
  futureDateOptions,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  REMINDER_DESCRIPTION_MAX_LENGTH,
  reminderDefaultOptions,
  resolveReminderDescription,
} from './reminder-schedule';

/** The composer's two questions, asked in this order. */
type Step = 'description' | 'when';

/**
 * Asks two questions — what and when — for a reminder about the entity the
 * command was invoked on.
 *
 * The date step is deliberately the date editor reached by `shift+cmd+o`: the
 * same shell, entity chip, search input and `useDateSearch` list. The
 * description step in front of it is optional, and Enter on an empty field
 * falls straight through to the date list.
 */
export function CreateReminderModal() {
  const [dialogRef, setDialogRef] = createSignal<HTMLElement | undefined>();
  const [attach, hotkeyScope] = useHotkeyDOMScope('reminder-composer');
  const [step, setStep] = createSignal<Step>('description');
  const [description, setDescription] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const createReminder = useCreateReminderMutation();
  const keybindings = useListKeyBindings(() => dialogRef());

  const entity = () => reminderComposerState.entity;

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
      setDescription('');
      setQuery('');
      setSelectedIndex(0);
    })
  );

  // The dialog's Enter binding is a single shared slot, so whichever step is on
  // screen has to claim it or the other step's stale handler stays live.
  createEffect(
    on(step, (current) => {
      if (current !== 'description') return;
      keybindings(descriptionStepKeybindings(() => setStep('when')));
    })
  );

  const submit = async (date: Date, target: EntityData) => {
    // The options are filtered against the time the list was built, so one can
    // slip into the past while the composer sits open. Re-check rather than
    // let the API reject it with an opaque failure.
    if (date.getTime() <= Date.now()) {
      toast.failure('That time has already passed — pick another');
      return;
    }

    const resolved = resolveReminderDescription(description(), target);
    const attachTo = reminderTarget(target);
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
    }
  };

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
                placeholder="What's the reminder? (optional)"
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
        <Show when={entity()}>
          {(target) => (
            <>
              <CommandMenuShell.Toolbar class="p-3 py-2 border-b-0 gap-2">
                <div class="bg-active border border-edge-muted px-2 py-1 truncate text-xs rounded max-w-[50%]">
                  <InlineEntity entity={target()} />
                </div>
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
              <Switch>
                <Match when={step() === 'description'}>
                  <DescriptionStep onContinue={() => setStep('when')} />
                </Match>
                <Match when={step() === 'when'}>
                  <CommandMenuShell.Body>
                    <WhenList
                      query={query}
                      selectedIndex={selectedIndex}
                      setSelectedIndex={setSelectedIndex}
                      onSubmit={(date) => void submit(date, target())}
                      setKeybindings={keybindings}
                    />
                  </CommandMenuShell.Body>
                </Match>
              </Switch>
            </>
          )}
        </Show>
      </CommandMenuShell>
    </Dialog>
  );
}

/**
 * What the description step does with the dialog's shared list bindings.
 *
 * There is no list to move through, so the arrows are inert and Enter is the
 * skip-through: it advances whether or not anything was typed.
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
 * The entity name a blank field falls back to is never pre-filled, so skipping
 * stays a single keystroke instead of a select-all and delete.
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
    if (!props.query().trim()) return reminderDefaultOptions(now);
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
