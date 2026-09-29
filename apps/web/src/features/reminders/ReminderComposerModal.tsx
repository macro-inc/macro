import { ItemPreview } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { EntitySelectionBadge } from '@entity/components/EntitySelectionBadge';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  reminderTarget,
  useCreateReminderMutation,
  useReminderQuery,
} from '@queries/reminders/reminders';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { ActionDialogShell, Button, confirmDialog, Dialog } from '@ui';
import {
  createMemo,
  createSignal,
  getOwner,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { ReminderForm, type ReminderFormValues } from './ReminderForm';
import {
  closeReminderComposer,
  reminderComposerOpen,
  reminderComposerState,
  takeReminderCreatedHandler,
} from './reminder-composer';
import {
  reminderFormPatch,
  reminderReferenceMention,
  useReminderDelete,
  useReminderUpdate,
} from './reminder-edit';
import {
  resolveReminderDescription,
  resolveStandaloneDescription,
} from './reminder-schedule';

/**
 * Edits an existing reminder in the composer's panel: the same form, seeded
 * with the reminder, saving a patch instead of creating a new one.
 */
function ReminderEditForm(props: {
  reminderId: string;
  onSubmit: (values: ReminderFormValues, reminder: Reminder) => void;
  onDelete: (reminder: Reminder) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const query = useReminderQuery(() => props.reminderId);
  // Gated on success: reading `data` while pending would suspend the dialog.
  const reminder = () => (query.isSuccess ? query.data : undefined);
  const reference = createMemo(() => {
    const current = reminder();
    return current ? reminderReferenceMention(current) : undefined;
  });

  return (
    <Switch
      fallback={
        <div class="flex items-center justify-center py-16 text-ink-muted">
          <SpinnerIcon class="size-5 animate-spin" />
        </div>
      }
    >
      <Match when={reminder()}>
        {(current) => (
          <ReminderForm
            layout="dialog"
            header={
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>Edit reminder</ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  Change what it says or when you’re reminded.
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>
            }
            initialDescription={current().description}
            initialSchedule={current().schedule}
            initialRemindAt={current().nextRunAt}
            placeholder="What's the reminder?"
            submitLabel="Save"
            reference={
              <Show when={reference()}>
                {(ref) => (
                  <div class="flex min-w-0">
                    <ItemPreview id={ref().id} type={ref().type} />
                  </div>
                )}
              </Show>
            }
            footerStart={
              <Button
                type="button"
                variant="danger"
                onClick={() => props.onDelete(current())}
              >
                Delete
              </Button>
            }
            onDirtyChange={props.onDirtyChange}
            onCancel={props.onCancel}
            onSubmit={(values) => props.onSubmit(values, current())}
          />
        )}
      </Match>
      <Match when={query.isError}>
        <div class="flex items-center justify-center py-16 text-sm text-ink-muted">
          This reminder is no longer available.
        </div>
      </Match>
    </Switch>
  );
}

/**
 * Creates a reminder — one about an entity, or one about nothing at all — in a
 * single panel, or edits an existing one in the same panel.
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
  // Held here rather than in the edit form: saving or deleting closes the
  // composer, which unmounts the form, before the request is awaited.
  const updateReminder = useReminderUpdate();
  const deleteReminder = useReminderDelete();
  const owner = getOwner();

  // Whether the open form holds edits that closing would throw away.
  const [dirty, setDirty] = createSignal(false);
  let closeConfirmationPending = false;

  /** Close without asking — after a save, a delete, or a confirmed discard. */
  const close = () => {
    setDirty(false);
    closeReminderComposer();
  };

  /** Close, asking first when there are unsaved changes. */
  const requestClose = async () => {
    if (closeConfirmationPending) return;
    if (dirty()) {
      closeConfirmationPending = true;
      try {
        const discard = await confirmDialog(
          {
            title: 'You still have remaining changes',
            body: 'Closing this reminder will discard your changes.',
            confirmLabel: 'Discard',
            cancelLabel: 'Keep editing',
            tone: 'danger',
          },
          { owner }
        );
        if (!discard) return;
      } finally {
        closeConfirmationPending = false;
      }
    }
    close();
  };

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
    close();

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
    close();

    try {
      await createReminder.mutateAsync({ description: resolved, schedule });
      toast.success('Reminder set');
    } catch {
      toast.failure('Failed to create reminder');
      return;
    }

    await onCreated?.();
  };

  const submitEdit = async (values: ReminderFormValues, reminder: Reminder) => {
    const patch = reminderFormPatch(reminder, values);
    close();
    // Neither answer moved — nothing to send, and an empty patch is rejected.
    if (!patch) return;

    try {
      await updateReminder.mutateAsync({ id: reminder.id, patch });
      toast.success('Reminder updated');
    } catch {
      toast.failure('Failed to update reminder');
    }
  };

  const requestDelete = async (reminder: Reminder) => {
    const confirmed = await confirmDialog(
      {
        title: 'Delete reminder?',
        body: 'This reminder will be permanently deleted. This cannot be undone.',
        confirmLabel: 'Delete',
        tone: 'danger',
      },
      { owner }
    );
    if (!confirmed) return;
    close();
    if (await deleteReminder(reminder)) toast.success('Reminder deleted');
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

  // Every target is cleared on close, so this unmounts the form while the
  // dialog animates shut — and remounts it fresh (clearing the title) on the
  // next open, since a close always sits between two opens.
  const hasTarget = () => entity() !== undefined || standalone();
  const editingId = () => reminderComposerState.editingId;

  return (
    <Dialog
      open={reminderComposerOpen()}
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
      position="center"
      class="w-110"
    >
      <ActionDialogShell>
        <Show when={editingId()} keyed>
          {(reminderId) => (
            <ReminderEditForm
              reminderId={reminderId}
              onSubmit={(values, reminder) => void submitEdit(values, reminder)}
              onDelete={(reminder) => void requestDelete(reminder)}
              onCancel={() => void requestClose()}
              onDirtyChange={setDirty}
            />
          )}
        </Show>
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
            onDirtyChange={setDirty}
            onCancel={() => void requestClose()}
            onSubmit={(values) => void handleSubmit(values)}
          />
        </Show>
      </ActionDialogShell>
    </Dialog>
  );
}
