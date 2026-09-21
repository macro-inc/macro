import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import { EntitySelectionBadge } from '@entity/components/EntitySelectionBadge';
import {
  reminderTarget,
  useCreateReminderMutation,
} from '@queries/reminders/reminders';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { CreateReminderRequest } from '@service-storage/generated/schemas/createReminderRequest';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import type { ReminderSchedule } from '@service-storage/generated/schemas/reminderSchedule';
import { ActionDialogShell, Dialog } from '@ui';
import { createSignal, Show } from 'solid-js';
import { globalSplitManager } from '../../lib/signals/splitLayout';
import { ReminderForm } from './ReminderForm';
import {
  closeReminderComposer,
  reminderComposerOpen,
  reminderComposerState,
  takeReminderCreatedHandler,
} from './reminder-composer';
import {
  describeReminderConfirmation,
  resolveReminderDescription,
  resolveStandaloneDescription,
} from './reminder-schedule';

const CREATE_FAILURE_MESSAGE =
  'We couldn’t save this reminder. Your draft is still here—try again. If the request timed out, it may already exist; check Reminders before retrying.';

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
  const [submitting, setSubmitting] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string>();
  let focusBeforeSave: HTMLElement | undefined;

  const save = async (args: CreateReminderRequest) => {
    if (submitting()) return;
    focusBeforeSave =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setSubmitting(true);
    setSaveError(undefined);

    let reminder: Reminder;
    try {
      reminder = await createReminder.mutateAsync(args);
    } catch {
      setSaveError(CREATE_FAILURE_MESSAGE);
      setSubmitting(false);
      queueMicrotask(() => {
        if (focusBeforeSave?.isConnected) focusBeforeSave.focus();
      });
      return;
    }

    const onCreated = takeReminderCreatedHandler();
    setSubmitting(false);
    closeReminderComposer();
    toast.success(
      `Reminder set · ${describeReminderConfirmation(reminder.schedule)}`,
      {
        actions: [
          {
            label: 'View',
            onClick: () =>
              globalSplitManager()?.openWithSplit(
                {
                  type: 'component',
                  id: `reminder-view~${reminder.id}`,
                },
                { activate: true }
              ),
          },
        ],
      }
    );
    // This host-owned follow-up runs only after persistence. It is intentionally
    // outside the request catch: a downstream row action failing does not mean
    // the reminder failed to save and must never invite a duplicate retry.
    try {
      await onCreated?.();
    } catch {
      toast.failure('Reminder saved, but the source could not be updated');
    }
  };

  const submitCreate = async (
    schedule: ReminderSchedule,
    target: EntityData,
    input: string
  ) => {
    const resolved = resolveReminderDescription(input, target);
    const attachTo = reminderTarget(target);
    await save({
      description: resolved,
      schedule,
      // Both or neither: the API rejects one without the other.
      ...(attachTo ?? undefined),
    });
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

    await save({ description: resolved, schedule });
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
        if (!open && !submitting()) {
          setSaveError(undefined);
          closeReminderComposer();
        }
      }}
      position="center"
      class="w-[calc(100vw-2rem)] max-w-110"
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
            autofocus
            pending={submitting()}
            error={saveError()}
            reference={
              <Show when={entity()}>
                {(target) => (
                  <div class="flex min-w-0">
                    <EntitySelectionBadge entity={target()} />
                  </div>
                )}
              </Show>
            }
            onCancel={() => {
              if (submitting()) return;
              setSaveError(undefined);
              closeReminderComposer();
            }}
            onSubmit={(values) => void handleSubmit(values)}
          />
        </Show>
      </ActionDialogShell>
    </Dialog>
  );
}
