import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  readChannelMessageReminder,
  removeChannelMessageReminder,
  saveChannelMessageReminder,
} from '@queries/reminders/channel-message';
import {
  Button,
  CommandMenuEmptyState,
  CommandMenuList,
  CommandMenuSearchInput,
  CommandMenuShell,
  createCommandListController,
  Dialog,
  type ManagedDialogProps,
} from '@ui';
import { createResource, createSignal, createUniqueId, Show } from 'solid-js';
import { createReminderTimeOptions } from '../primitives/create-reminder-time-options';
import { formatReminderInstant } from '../reminder-schedule';

/** Time picker for a reminder that opens this channel message. */
export function MessageReminderComposer(
  props: ManagedDialogProps & {
    channelId: string;
    messageId: string;
    description: string;
  }
) {
  const id = createUniqueId();
  const [query, setQuery] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const times = createReminderTimeOptions(query);
  const [current, { refetch }] = createResource(
    () => ({ channelId: props.channelId, messageId: props.messageId }),
    (key) => readChannelMessageReminder(key.channelId, key.messageId)
  );
  const select = (option: { date: Date }) => {
    if (pending() || option.date.getTime() <= Date.now()) return;
    setPending(true);
    setError(undefined);
    fireAndForget(
      (async () => {
        try {
          await saveChannelMessageReminder(props.channelId, props.messageId, {
            remindAt: option.date.toISOString(),
            description: props.description,
          });
          props.onOpenChange(false);
          toast.success('Reminder set', {
            subtext: formatReminderInstant(option.date),
          });
        } catch {
          setError('Couldn’t set the reminder. Try again.');
          setPending(false);
        }
      })(),
      'channel-message-reminder'
    );
  };
  const list = createCommandListController({
    items: () => times(),
    onSelect: select,
  });
  const remove = () => {
    if (pending() || !current()) return;
    setPending(true);
    setError(undefined);
    fireAndForget(
      (async () => {
        try {
          await removeChannelMessageReminder(props.channelId, props.messageId);
          props.onOpenChange(false);
          toast.success('Reminder removed');
        } catch {
          setError('Couldn’t remove the reminder. Try again.');
          setPending(false);
        }
      })(),
      'channel-message-reminder'
    );
  };
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
              times().length ? `${id}-${list.selectedIndex()}` : undefined
            }
            placeholder={`Remind me: ${props.description}`}
            value={query()}
            disabled={pending()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
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
        <Dialog.Description class="sr-only">
          {props.description}
        </Dialog.Description>
        <Show when={current()?.remindAt}>
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
            items={times()}
            selectedIndex={list.selectedIndex()}
            scrollSelectedIntoView={list.shouldScrollSelectedIntoView()}
            itemId={(_, index) => `${id}-${index}`}
            itemDisabled={() => pending()}
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
          <Show when={!times().length}>
            <CommandMenuEmptyState>
              Enter a future time, like in 2 hours or tomorrow 9am.
            </CommandMenuEmptyState>
          </Show>
          <Show when={error()}>
            <p role="alert" class="px-4 pb-3 text-sm text-failure-ink">
              {error()}
            </p>
          </Show>
          <Show when={current.state === 'errored'}>
            <p role="alert" class="px-4 pb-3 text-sm text-failure-ink">
              Couldn’t load the current reminder.{' '}
              <Button variant="ghost" onClick={() => refetch()}>
                Retry
              </Button>
            </p>
          </Show>
        </CommandMenuShell.Body>
        <CommandMenuShell.Footer class="flex items-center justify-between gap-2 p-2">
          <Button
            variant="ghost"
            disabled={pending()}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Show when={current()}>
            <Button variant="ghost" disabled={pending()} onClick={remove}>
              Remove reminder
            </Button>
          </Show>
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </Dialog>
  );
}
