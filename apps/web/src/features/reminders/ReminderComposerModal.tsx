import { toast } from '@core/component/Toast/Toast';
import { EntitySelectionBadge } from '@entity/components/EntitySelectionBadge';
import {
  reminderTarget,
  useCreateReminderMutation,
} from '@queries/reminders/reminders';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { ActionDialogShell, Dialog } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ReminderForm } from './ReminderForm';
import {
  closeReminderComposer,
  reminderComposerOpen,
  reminderComposerState,
  takeReminderCreatedHandler,
} from './reminder-composer';
import {
  resolveReminderDescription,
  resolveStandaloneDescription,
} from './reminder-schedule';

/**
 * Creates a reminder — one about an entity, or one about nothing at all — in a
 * single panel. Editing an existing reminder happens in its own split view
 * (`ReminderEditorSplit`), not here, so this only ever composes a new one.
 */
export function ReminderComposerModal() {
  // Nothing else brings a new reminder into Soup: the service emits no
  // websocket event on create (its only outbound signals are the dispatch
  // queue and the notification when a reminder fires), so without this fetch
  // the Scheduled/Pending lists only learn about the reminder on their next
  // full fetch.
  const createReminder = useCreateReminderMutation({
    onSuccess: (reminder) => void refetchSoupEntity(reminder.id, 'reminder'),
  });

  const entity = () => reminderComposerState.entity;
  const standalone = () => reminderComposerState.standalone === true;

  const [error, setError] = createSignal('');
  const close = () => {
    if (createReminder.isPending) return;
    setError('');
    closeReminderComposer();
  };

  const handleSubmit = async (values: {
    description: string;
    schedule: ReminderSchedule;
  }) => {
    if (createReminder.isPending) return;
    const target = entity();
    if (!target && !standalone()) return;
    const description = target
      ? resolveReminderDescription(values.description, target)
      : resolveStandaloneDescription(values.description);
    if (!description) return;
    setError('');
    try {
      await createReminder.mutateAsync({
        description,
        schedule: values.schedule,
        ...(target ? reminderTarget(target) : undefined),
      });
    } catch {
      setError('Could not set the reminder. Please try again.');
      return;
    }
    const onCreated = takeReminderCreatedHandler();
    closeReminderComposer();
    toast.success('Reminder set');
    // The reminder is already saved; a follow-up failure must not offer to create it again.
    try {
      await onCreated?.();
    } catch {
      toast.failure('Reminder set, but the item could not be updated');
    }
  };

  // Both targets are cleared on close, so this unmounts the form while the
  // dialog animates shut — and remounts it fresh (clearing the title) on the
  // next open, since a close always sits between two opens.
  const hasTarget = () => entity() !== undefined || standalone();

  return (
    <Dialog
      open={reminderComposerOpen()}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      position="center"
      class="w-110"
    >
      <ActionDialogShell>
        <Show when={hasTarget()}>
          <ReminderForm
            layout="dialog"
            header={
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>New reminder</ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  Choose when you’d like to be reminded.
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>
            }
            placeholder={
              standalone()
                ? "What's the reminder?"
                : "What's the reminder? (optional)"
            }
            descriptionRequired={standalone()}
            submitLabel="Set reminder"
            pending={createReminder.isPending}
            error={error()}
            reference={
              <Show when={entity()}>
                {(target) => (
                  <div class="flex min-w-0">
                    <EntitySelectionBadge entity={target()} />
                  </div>
                )}
              </Show>
            }
            onCancel={close}
            onSubmit={(values) => void handleSubmit(values)}
          />
        </Show>
      </ActionDialogShell>
    </Dialog>
  );
}
