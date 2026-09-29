import { createBulkDeleteDssItemsMutation, type ReminderEntity } from '@entity';
import {
  reminderSoupPatch,
  useUpdateReminderMutation,
} from '@queries/reminders/reminders';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
} from '@queries/soup/cache';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import type { ReminderFormValues } from './ReminderForm';
import {
  isRecurring,
  reminderEditPatch,
  resolveEditedDescription,
} from './reminder-schedule';

/**
 * The reminder update mutation, with the Soup row brought in line on success.
 *
 * Soup rows come from the normalized soup cache, not the reminders queries, so
 * the mutation's own invalidation leaves the row reading its old description
 * and firing time until a reload. `nextRunAt` is derived server-side, so this
 * applies the value the server returned rather than an optimistic guess.
 */
export function useReminderUpdate() {
  return useUpdateReminderMutation({
    onSuccess: (reminder) =>
      optimisticUpdateSoupEntity(
        reminderSoupPatch(
          reminder,
          getSoupEntityById(reminder.id)?.frecency_score
        )
      ),
  });
}

/** The reminder as the entity Soup's rows and actions carry. */
function reminderEntity(reminder: Reminder): ReminderEntity {
  const { schedule } = reminder;
  return {
    type: 'reminder',
    id: reminder.id,
    // A reminder has no separate title — its description is its name.
    name: reminder.description,
    description: reminder.description,
    // Reminders are private to their owner, so they carry no owner id.
    ownerId: '',
    scheduleType: schedule.type,
    cron: isRecurring(schedule) ? schedule.cron : undefined,
    timezone: isRecurring(schedule) ? schedule.timezone : undefined,
    nextRunAt: reminder.nextRunAt,
    enabled: reminder.enabled,
    completedAt: reminder.completedAt ?? null,
  };
}

/**
 * Delete a reminder the way Soup's Delete action does, so its row leaves
 * every Soup list and the notification it produced is retracted with it.
 * Resolves `true` once it is gone; a failure is reported by the mutation
 * itself, which also restores the row.
 */
export function useReminderDelete() {
  const bulkDelete = createBulkDeleteDssItemsMutation();

  return async (reminder: Reminder) => {
    try {
      await bulkDelete.mutateAsync([reminderEntity(reminder)]);
      return true;
    } catch {
      return false;
    }
  };
}

/** The patch saving the form sends, or `undefined` when nothing moved. */
export function reminderFormPatch(
  reminder: Reminder,
  values: ReminderFormValues
) {
  return reminderEditPatch(
    {
      description: reminder.description,
      schedule: reminder.schedule,
      completed: reminder.completedAt != null,
    },
    {
      // A blanked title keeps the current description rather than re-deriving
      // the referenced entity's name. It cannot safely re-derive: a thread
      // reminder attaches to its parent channel but is described by the
      // message text, so naming it after the channel would drop the only thing
      // telling two reminders on that channel apart — and the stored reminder
      // cannot tell a thread reminder from a plain channel one.
      description: resolveEditedDescription(
        values.description,
        reminder.description
      ),
      schedule: values.schedule,
    }
  );
}

/** The display type an inline mention takes for the referenced entity. */
type MentionType = NonNullable<ReminderEntity['referencedEntity']>['type'];

/**
 * The referenced entity as a mention, resolved from the reminder's stored
 * `entityType` (the API name) to the display type a mention chip renders. The
 * chip resolves the name, icon, and access state itself. `undefined` for a
 * standalone reminder, or a target that has no mention of its own.
 */
export function reminderReferenceMention(
  reminder: Reminder
): { id: string; type: MentionType } | undefined {
  if (!reminder.entityId || !reminder.entityType) return undefined;
  const type: MentionType | undefined =
    reminder.entityType === 'email_thread'
      ? 'email'
      : reminder.entityType === 'foreign_entity'
        ? 'foreign'
        : // A message reminder attaches to its parent channel; the rest map
          // straight across (document, chat, project, channel, call, crm_*).
          reminder.entityType === 'channel_message'
          ? 'channel'
          : reminder.entityType === 'document' ||
              reminder.entityType === 'chat' ||
              reminder.entityType === 'project' ||
              reminder.entityType === 'channel' ||
              reminder.entityType === 'call' ||
              reminder.entityType === 'crm_company' ||
              reminder.entityType === 'crm_contact'
            ? reminder.entityType
            : undefined;
  return type ? { id: reminder.entityId, type } : undefined;
}
