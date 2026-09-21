import { useCalendarUiFlag } from '@app/features/calendar/hooks/use-calendar-ui-flag';
import { openCalendarEventSplit } from '@block-calendar/open-calendar-event';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { ItemPreview } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import type { ReminderEntity } from '@entity';
import BellIcon from '@phosphor/bell-simple.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
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
import { Button } from '@ui';
import {
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { ReminderForm, type ReminderFormValues } from './ReminderForm';
import {
  describeReminderConfirmation,
  reminderEditPatch,
  resolveEditedDescription,
} from './reminder-schedule';

/** The display type an inline mention takes for the referenced entity. */
type MentionType = NonNullable<ReminderEntity['referencedEntity']>['type'];

/**
 * The referenced entity as a mention, resolved from the reminder's stored
 * `entityType` (the API name) to the display type a mention chip renders. The
 * chip resolves the name, icon, and access state itself. `undefined` for a
 * standalone reminder, or a target that has no mention of its own.
 */
function referenceMention(
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

/**
 * Props shared by split and inline-preview reminder detail adapters.
 *
 * The host owns close/navigation behavior so the editor content does not need
 * to know whether it is mounted as a restorable split or Home's detail pane.
 */
export type ReminderDetailsProps = {
  reminderId: string | undefined;
  onClose: VoidFunction;
};

/**
 * Reminder detail content shared by the restorable component split and Home's
 * inline preview.
 *
 * It fetches the reminder by id (the id is encoded in the split content, so it
 * survives a reload), seeds the shared {@link ReminderForm}, and shows the
 * entity the reminder is about as a preview card. Saving writes through the same
 * mutation the create modal uses and asks its host to close.
 */
export function ReminderDetails(props: ReminderDetailsProps) {
  let active = true;
  onCleanup(() => {
    active = false;
  });

  const calendarUiEnabled = useCalendarUiFlag();
  const query = useReminderQuery(() => props.reminderId);
  const [updateError, setUpdateError] = createSignal<string>();
  let focusBeforeSave: HTMLElement | undefined;

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
    const reminder = query.isSuccess ? query.data : undefined;
    return reminder ? referenceMention(reminder) : undefined;
  });
  const calendarEventId = createMemo(() => {
    if (!query.isSuccess || query.data.entityType !== 'calendar_event') {
      return undefined;
    }
    return query.data.entityId;
  });
  const reminderUnavailable = () =>
    !props.reminderId ||
    query.isError ||
    (query.isSuccess && query.data === undefined);

  const save = async (values: ReminderFormValues, reminder: Reminder) => {
    if (updateReminder.isPending) return;
    focusBeforeSave =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    setUpdateError(undefined);
    const patch = reminderEditPatch(
      {
        description: reminder.description,
        schedule: reminder.schedule,
        completed: reminder.completedAt != null,
      },
      {
        // A blanked title keeps the current description rather than re-deriving
        // the referenced entity's name. It cannot safely re-derive: a thread
        // reminder attaches to its parent channel but is described by the
        // message text, so naming it after the channel would drop the only
        // thing telling two reminders on that channel apart — and the stored
        // reminder cannot tell a thread reminder from a plain channel one.
        description: resolveEditedDescription(
          values.description,
          reminder.description
        ),
        schedule: values.schedule,
      }
    );
    // Neither answer moved — nothing to send, and an empty patch is rejected.
    if (!patch) {
      props.onClose();
      return;
    }
    const submittedReminderId = reminder.id;
    try {
      const updated = await updateReminder.mutateAsync({
        id: reminder.id,
        patch,
      });
      if (!active || props.reminderId !== submittedReminderId) return;
      toast.success(
        `Reminder updated · ${describeReminderConfirmation(updated.schedule)}`
      );
      props.onClose();
    } catch {
      if (!active || props.reminderId !== submittedReminderId) return;
      setUpdateError(
        'We couldn’t save these changes. Your edits are still here—try again.'
      );
      queueMicrotask(() => {
        if (
          active &&
          props.reminderId === submittedReminderId &&
          focusBeforeSave?.isConnected
        ) {
          focusBeforeSave.focus();
        }
      });
    }
  };

  return (
    <div class="h-full min-h-0 overflow-y-auto bg-panel font-sans">
      <div class="mx-auto w-full max-w-xl p-6">
        <Switch>
          <Match when={query.isSuccess ? query.data : undefined}>
            {(reminder) => (
              <ReminderForm
                initialDescription={reminder().description}
                initialSchedule={reminder().schedule}
                initialRemindAt={reminder().nextRunAt}
                placeholder="Reminder description"
                submitLabel="Save"
                pending={updateReminder.isPending}
                error={updateError()}
                reference={
                  <>
                    <Show when={reference()}>
                      {(ref) => (
                        <div class="flex flex-col gap-1">
                          <span class="text-xs font-medium text-ink-muted">
                            Original item
                          </span>
                          <div class="flex">
                            <ItemPreview id={ref().id} type={ref().type} />
                          </div>
                        </div>
                      )}
                    </Show>
                    <Show
                      when={calendarUiEnabled() ? calendarEventId() : undefined}
                    >
                      {(eventId) => (
                        <div class="flex flex-col gap-1">
                          <span class="text-xs font-medium text-ink-muted">
                            Original item
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            class="self-start"
                            onClick={() =>
                              void openCalendarEventSplit({
                                eventId: eventId(),
                              })
                            }
                          >
                            <CalendarBlankIcon class="size-4" />
                            Open calendar event
                          </Button>
                        </div>
                      )}
                    </Show>
                  </>
                }
                onCancel={props.onClose}
                onSubmit={(values) => void save(values, reminder())}
              />
            )}
          </Match>
          <Match when={query.isPending && !!props.reminderId}>
            <div class="flex items-center justify-center py-16 text-ink-muted">
              <SpinnerIcon class="size-5 animate-spin" />
            </div>
          </Match>
          <Match when={reminderUnavailable()}>
            <div class="flex flex-col items-center justify-center gap-2 py-16 text-ink-muted">
              <BellIcon class="size-6 text-ink-extra-muted" />
              <span class="text-center text-sm">
                This reminder is unavailable or you no longer have access.
              </span>
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
}

/** Restorable split adapter for {@link ReminderDetails}. */
export function ReminderEditorSplit(props: { reminderId: string | undefined }) {
  const panel = useSplitPanelOrThrow();
  onMount(() => panel.handle.setDisplayName('Reminder'));

  return (
    <ReminderDetails
      reminderId={props.reminderId}
      onClose={() => panel.handle.close()}
    />
  );
}
