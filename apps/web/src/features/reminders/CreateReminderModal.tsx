import { toast } from '@core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useListKeyBindings } from '@core/util/useListKeyBindings';
import { type EntityData, InlineEntity } from '@entity';
import BellIcon from '@phosphor/bell-simple.svg';
import {
  reminderTarget,
  useCreateReminderMutation,
} from '@queries/reminders/reminders';
import { mergeRefs } from '@solid-primitives/refs';
import {
  CommandMenuEmptyState,
  CommandMenuListItem,
  CommandMenuSearchInput,
  CommandMenuShell,
  Dialog,
} from '@ui';
import {
  createEffect,
  createMemo,
  createSelector,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import {
  closeReminderComposer,
  reminderComposerOpen,
  reminderComposerState,
} from './reminder-composer';
import {
  futureDateOptions,
  onceSchedule,
  REMINDER_DEFAULT_TIME,
  reminderDefaultOptions,
  reminderDescriptionFor,
} from './reminder-schedule';

/**
 * Asks one question — when — for a reminder about the entity the command was
 * invoked on.
 *
 * This is deliberately the date editor reached by `shift+cmd+o`: the same shell,
 * entity chip, search input and `useDateSearch` list. The entity is already
 * known, so there is nothing to pick but the date.
 */
export function CreateReminderModal() {
  const [dialogRef, setDialogRef] = createSignal<HTMLElement | undefined>();
  const [attach, hotkeyScope] = useHotkeyDOMScope('reminder-composer');
  const [query, setQuery] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const createReminder = useCreateReminderMutation();
  const keybindings = useListKeyBindings(() => dialogRef());

  const entity = () => reminderComposerState.entity;

  const { dispose: disposeHotkey } = registerHotkey({
    hotkey: ['escape'],
    description: 'Close reminder composer',
    keyDownHandler: () => {
      closeReminderComposer();
      return true;
    },
    scopeId: hotkeyScope,
  });
  onCleanup(disposeHotkey);

  createEffect(
    on(reminderComposerOpen, () => {
      setQuery('');
      setSelectedIndex(0);
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

    const description = reminderDescriptionFor(target);
    const attachTo = reminderTarget(target);
    closeReminderComposer();

    try {
      await createReminder.mutateAsync({
        description,
        schedule: onceSchedule(date),
        // Both or neither: the API rejects one without the other.
        ...(attachTo ?? undefined),
      });
      toast.success(`Reminder set for ${formatWhen(date)}`);
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
      contentRef={mergeRefs(attach, setDialogRef)}
    >
      <CommandMenuShell depth={2} class="rounded-xl max-h-108 text-sm">
        <CommandMenuShell.Header>
          <span class="pl-2 text-ink-extra-muted/55 pointer-events-none">
            <BellIcon class="size-3" />
          </span>
          <CommandMenuSearchInput
            class="text-base"
            placeholder="Remind me when?"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            autofocus
          />
        </CommandMenuShell.Header>
        <Show when={entity()}>
          {(target) => (
            <>
              <CommandMenuShell.Toolbar class="p-3 py-2 border-b-0">
                <div class="bg-active border border-edge-muted px-2 py-1 truncate text-xs rounded max-w-[50%]">
                  <InlineEntity entity={target()} />
                </div>
              </CommandMenuShell.Toolbar>
              <CommandMenuShell.Body>
                <WhenList
                  query={query}
                  selectedIndex={selectedIndex}
                  setSelectedIndex={setSelectedIndex}
                  onSubmit={(date) => void submit(date, target())}
                  setKeybindings={keybindings}
                />
              </CommandMenuShell.Body>
            </>
          )}
        </Show>
      </CommandMenuShell>
    </Dialog>
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

      <div class="p-4 border-t border-edge-muted">
        <div class="text-xs text-ink-muted">
          <span>Use queries like </span>
          <code class="bg-active px-1">3d</code>,{' '}
          <code class="bg-active px-1">1w</code>,{' '}
          <code class="bg-active px-1">feb 17</code>,{' '}
          <code class="bg-active px-1">tomorrow</code>, or{' '}
          <code class="bg-active px-1">tomorrow 3pm</code>
        </div>
      </div>
    </>
  );
}

function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
