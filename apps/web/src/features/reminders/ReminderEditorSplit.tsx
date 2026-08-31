import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { BlockAlias, BlockName } from '@core/block';
import { DocumentPreviewContent } from '@core/component/DocumentPreview';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import BellIcon from '@phosphor/bell-simple.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import {
  reminderSoupPatch,
  useReminderQuery,
  useUpdateReminderMutation,
} from '@queries/reminders/reminders';
import {
  getSoupEntityById,
  optimisticUpdateSoupEntity,
} from '@queries/soup/cache';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import { createMemo, Match, onMount, Show, Switch } from 'solid-js';
import { ReminderForm, type ReminderFormValues } from './ReminderForm';
import {
  reminderEditPatch,
  resolveEditedDescription,
} from './reminder-schedule';

/**
 * The block the referenced entity opens as, for the preview card.
 *
 * Derived from the reminder's stored `entityType` (the API name); the card
 * self-corrects to the real block (a document's task/canvas subtype, say) once
 * the item loads. `undefined` for a standalone reminder.
 */
function referenceBlock(
  reminder: Reminder
): { id: string; type: BlockName | BlockAlias } | undefined {
  if (!reminder.entityId || !reminder.entityType) return undefined;
  const display =
    reminder.entityType === 'email_thread'
      ? 'email'
      : reminder.entityType === 'foreign_entity'
        ? 'foreign'
        : reminder.entityType;
  return { id: reminder.entityId, type: fileTypeToBlockName(display) };
}

/**
 * The reminder editor, hosted in a split so it previews into the Viewer like any
 * other entity rather than a modal over the list.
 *
 * It fetches the reminder by id (the id is encoded in the split content, so it
 * survives a reload), seeds the shared {@link ReminderForm}, and shows the
 * entity the reminder is about as a preview card. Saving writes through the same
 * mutation the create modal uses and closes the split.
 */
export function ReminderEditorSplit(props: { reminderId: string }) {
  const panel = useSplitPanelOrThrow();
  onMount(() => panel.handle.setDisplayName('Reminder'));

  const query = useReminderQuery(() => props.reminderId);

  // Soup rows come from the normalized soup cache, not the reminders queries, so
  // the mutation's own invalidation leaves the row reading its old description
  // and firing time until a reload. `nextRunAt` is derived server-side, so this
  // applies the value the server returned rather than an optimistic guess.
  const updateReminder = useUpdateReminderMutation({
    onSuccess: (reminder) =>
      optimisticUpdateSoupEntity(
        reminderSoupPatch(
          reminder,
          getSoupEntityById(reminder.id)?.frecency_score
        )
      ),
  });

  const reference = createMemo(() => {
    const reminder = query.data;
    return reminder ? referenceBlock(reminder) : undefined;
  });

  const save = async (values: ReminderFormValues, reminder: Reminder) => {
    const patch = reminderEditPatch(
      {
        description: reminder.description,
        schedule: reminder.schedule,
        completed: reminder.completedAt != null,
      },
      {
        // Blank means the same here as it does when creating: name it after
        // whatever it is about. Without a resolved reference name to fall back
        // to, a blank field keeps the current description.
        description: resolveEditedDescription(
          values.description,
          reminder.description
        ),
        schedule: values.schedule,
      }
    );
    // Neither answer moved — nothing to send, and an empty patch is rejected.
    if (!patch) {
      panel.handle.close();
      return;
    }
    try {
      await updateReminder.mutateAsync({ id: reminder.id, patch });
      toast.success('Reminder updated');
      panel.handle.close();
    } catch {
      toast.failure('Failed to update reminder');
    }
  };

  return (
    <div class="h-full min-h-0 overflow-y-auto bg-panel font-sans">
      <div class="mx-auto w-full max-w-xl p-6">
        <Switch>
          <Match when={query.data}>
            {(reminder) => (
              <ReminderForm
                initialDescription={reminder().description}
                initialSchedule={reminder().schedule}
                placeholder="Reminder description"
                submitLabel="Save"
                pending={updateReminder.isPending}
                reference={
                  <Show when={reference()}>
                    {(ref) => (
                      <div class="rounded-lg border border-edge-muted bg-surface p-1">
                        <DocumentPreviewContent
                          documentInfo={{
                            id: ref().id,
                            type: ref().type,
                            params: {},
                          }}
                        />
                      </div>
                    )}
                  </Show>
                }
                revertOnCancel
                onCancel={(wasDirty) => {
                  // Reverting an edit keeps the panel open; a clean cancel
                  // dismisses the preview.
                  if (!wasDirty) panel.handle.close();
                }}
                onSubmit={(values) => void save(values, reminder())}
              />
            )}
          </Match>
          <Match when={query.isLoading}>
            <div class="flex items-center justify-center py-16 text-ink-muted">
              <SpinnerIcon class="size-5 animate-spin" />
            </div>
          </Match>
          <Match when={query.isError || !query.data}>
            <div class="flex flex-col items-center justify-center gap-2 py-16 text-ink-muted">
              <BellIcon class="size-6 text-ink-extra-muted" />
              <span class="text-sm">This reminder is no longer available.</span>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}
