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
    ready?: boolean;
    error?: string;
    onRetry?: () => void;
    onSave: (at: Date, condition: EmailReminderCondition) => void;
    onRemove?: () => void;
  }
) {
  const id = createUniqueId();
  const select = (option: { date: Date }) => {
    if (
      props.ready !== false &&
      !props.pending &&
      option.date.getTime() > Date.now()
    )
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
            placeholder={`Remind me: ${props.subject}`}
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
        <Dialog.Title class="sr-only">Remind me</Dialog.Title>
        <Dialog.Description class="sr-only">{props.subject}</Dialog.Description>
        <Show when={props.initialTime}>
          {(time) => (
            <CommandMenuShell.Toolbar class="px-5 py-2">
              <p class="text-xs text-ink-muted">
                Scheduled for {formatReminderInstant(new Date(time()))}
              </p>
            </CommandMenuShell.Toolbar>
          )}
        </Show>
        <CommandMenuShell.Body class="flex flex-col">
          <CommandMenuList
            id={`${id}-options`}
            items={props.times}
            selectedIndex={list.selectedIndex()}
            scrollSelectedIntoView={list.shouldScrollSelectedIntoView()}
            itemId={(_, index) => `${id}-${index}`}
            itemDisabled={() => props.pending || props.ready === false}
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
        {/* p-2 insets the h-8 pill so its 16px radius stays concentric
            with the dialog's 24px corner. */}
        <CommandMenuShell.Footer class="grid grid-cols-[1fr_auto_1fr] gap-2 p-2">
          <div class="flex items-center gap-1 justify-self-start">
            <Button
              variant="ghost"
              disabled={props.pending}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Show when={props.onRetry}>
              <Button variant="ghost" onClick={() => props.onRetry?.()}>
                Retry
              </Button>
            </Show>
            <Show when={props.onRemove}>
              <Button
                variant="ghost"
                disabled={props.pending || props.ready === false}
                onClick={() => props.onRemove?.()}
              >
                Remove reminder
              </Button>
            </Show>
          </div>
          <span role="status" class="min-w-0 truncate text-center">
            {props.pending ? 'Saving…' : '↑ ↓ to choose · Enter to snooze'}
          </span>
          <SegmentedControl<EmailReminderCondition>
            aria-label="Reminder condition"
            class="justify-self-end"
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
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </Dialog>
  );
}
