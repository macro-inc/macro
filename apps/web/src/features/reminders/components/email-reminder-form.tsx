import {
  Button,
  CommandMenuEmptyState,
  CommandMenuList,
  CommandMenuSearchInput,
  CommandMenuShell,
  createCommandListController,
  Dialog,
  type ManagedDialogProps,
  SegmentedControl,
} from '@ui';
import { createUniqueId, Show } from 'solid-js';
import type {
  EmailReminderCondition,
  ReminderTimeOption,
} from '../core/email-reminder';
import { formatReminderInstant } from '../reminder-schedule';

/** Email snooze command menu; selecting a time saves immediately. */
export function EmailReminderForm(
  props: ManagedDialogProps & {
    subject: string;
    initialTime?: string;
    query: string;
    onQueryChange: (value: string) => void;
    condition: EmailReminderCondition;
    onConditionChange: (value: EmailReminderCondition) => void;
    times: readonly ReminderTimeOption[];
    pending: boolean;
    error?: string;
    onSave: (at: Date, condition: EmailReminderCondition) => void;
    onRemove?: () => void;
  }
) {
  const id = createUniqueId();
  const select = (option: { date: Date }) => {
    if (!props.pending && option.date.getTime() > Date.now())
      props.onSave(option.date, props.condition);
  };
  const list = createCommandListController({
    items: () => props.times,
    onSelect: select,
  });
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} visibleScrim>
      <CommandMenuShell>
        <CommandMenuShell.Header>
          <CommandMenuSearchInput
            aria-label="Remind me when"
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-options`}
            aria-activedescendant={
              props.times.length ? `${id}-${list.selectedIndex()}` : undefined
            }
            placeholder="Choose a time, or type tomorrow 9am…"
            value={props.query}
            disabled={props.pending}
            onInput={(event) => {
              props.onQueryChange(event.currentTarget.value);
              list.setSelectedIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                list.selectNext();
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                list.selectPrevious();
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                list.selectSelected();
              }
            }}
          />
        </CommandMenuShell.Header>
        <CommandMenuShell.Toolbar class="flex-col items-start gap-2 px-4 py-3">
          <Dialog.Title class="text-sm font-medium text-ink">
            Remind me
          </Dialog.Title>
          <Dialog.Description class="max-w-full truncate text-xs text-ink-muted">
            {props.subject}
          </Dialog.Description>
          <Show when={props.initialTime}>
            {(time) => (
              <p class="text-xs text-ink-muted">
                Scheduled for {formatReminderInstant(new Date(time()))}
              </p>
            )}
          </Show>
          <SegmentedControl<EmailReminderCondition>
            aria-label="Reminder condition"
            value={props.condition}
            onChange={props.onConditionChange}
            options={[
              {
                value: 'if_no_reply',
                label: 'If no reply',
                disabled: props.pending,
              },
              {
                value: 'regardless',
                label: 'Regardless',
                disabled: props.pending,
              },
            ]}
          />
        </CommandMenuShell.Toolbar>
        <CommandMenuShell.Body class="flex flex-col">
          <CommandMenuList
            id={`${id}-options`}
            items={props.times}
            selectedIndex={list.selectedIndex()}
            scrollSelectedIntoView={list.shouldScrollSelectedIntoView()}
            itemId={(_, index) => `${id}-${index}`}
            itemDisabled={() => props.pending}
            onItemMouseMove={list.setSelectedIndexFromPointer}
            onSelect={select}
            class="min-h-0 max-h-80 mobile:[&_[role=option]]:h-auto mobile:[&_[role=option]]:min-h-12"
          >
            {(option) => (
              <div class="flex min-w-0 flex-1 items-center gap-2 mobile:flex-col mobile:items-start mobile:gap-0.5">
                <span class="flex-1 font-medium">{option.label}</span>
                <span class="text-xs font-normal text-ink-muted">
                  {formatReminderInstant(option.date)}
                </span>
              </div>
            )}
          </CommandMenuList>
          <Show when={!props.times.length}>
            <CommandMenuEmptyState>
              Enter a future time, like in 2 hours or tomorrow 9am.
            </CommandMenuEmptyState>
          </Show>
          <Show when={props.error}>
            <p role="alert" class="px-4 pb-3 text-sm text-failure-ink">
              {props.error}
            </p>
          </Show>
        </CommandMenuShell.Body>
        <CommandMenuShell.Footer>
          <span role="status">
            {props.pending ? 'Saving…' : '↑ ↓ to choose · Enter to snooze'}
          </span>
          <Show when={props.onRemove}>
            <Button
              variant="ghost"
              disabled={props.pending}
              onClick={() => props.onRemove?.()}
            >
              Remove reminder
            </Button>
          </Show>
          <Button
            variant="ghost"
            disabled={props.pending}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </Dialog>
  );
}
