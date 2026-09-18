import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { EntitySelectionBadge } from '@entity/components/EntitySelectionBadge';
import {
  reminderTarget,
  useCreateReminderMutation,
} from '@queries/reminders/reminders';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { ActionDialogShell, Dialog } from '@ui';
import { Show } from 'solid-js';
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

  const submitCreate = async (
    schedule: ReminderSchedule,
    target: EntityData,
    input: string
  ) => {
    const resolved = resolveReminderDescription(input, target);
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
  const submitStandalone = async (
    schedule: ReminderSchedule,
    input: string
  ) => {
    const resolved = resolveStandaloneDescription(input);
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

  const handleSubmit = (values: {
    description: string;
    schedule: ReminderSchedule;
  }) => {
    const target = entity();
    if (target) {
      void submitCreate(values.schedule, target, values.description);
      return;
    }
    if (standalone())
      void submitStandalone(values.schedule, values.description);
  };

  // Both targets are cleared on close, so this unmounts the form while the
  // dialog animates shut — and remounts it fresh (clearing the title) on the
  // next open, since a close always sits between two opens.
  const hasTarget = () => entity() !== undefined || standalone();

  return (
    <Dialog
      open={reminderComposerOpen()}
      onOpenChange={(open) => {
        if (!open) closeReminderComposer();
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
            reference={
              <Show when={entity()}>
                {(target) => (
                  <div class="flex min-w-0">
                    <EntitySelectionBadge entity={target()} />
                  </div>
                )}
              </Show>
            }
            onCancel={closeReminderComposer}
            onSubmit={(values) => void handleSubmit(values)}
          />
        </Show>
      </ActionDialogShell>
    </Dialog>
  );
}
