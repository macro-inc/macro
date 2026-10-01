import { ItemPreview } from '@core/component/ItemPreview';
import { toast } from '@core/component/Toast/Toast';
import {
  executeEmailFollowup,
  useEmailFollowupQuery,
} from '@queries/reminders/email-followup';
import type { EmailFollowupCommand } from '@service-storage/generated/schemas/emailFollowupCommand';
import type { Reminder } from '@service-storage/generated/schemas/reminder';
import { createSignal, type JSX, Show } from 'solid-js';
import { EmailReminderForm } from '../components/email-reminder-form';

/** Generic email-attached reminders retain their ordinary editor. */
export function EmailReminderDetails(props: {
  reminder: Reminder;
  threadId: string;
  onClose: () => void;
  children: JSX.Element;
}) {
  const query = useEmailFollowupQuery(() => props.threadId);
  const followup = () =>
    query.isSuccess && query.data?.reminderId === props.reminder.id
      ? query.data
      : undefined;
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let lastCommand: EmailFollowupCommand | undefined;
  const save = async (command: EmailFollowupCommand) => {
    if (pending()) return;
    // Preserve the identity for retries with the same requested fields.
    const retry =
      lastCommand && command.expectedRevision === lastCommand.operationId
        ? { ...command, expectedRevision: lastCommand.expectedRevision }
        : command;
    if (
      !lastCommand ||
      JSON.stringify({ ...lastCommand, operationId: undefined }) !==
        JSON.stringify({ ...retry, operationId: undefined })
    )
      lastCommand = command;
    setPending(true);
    setError(undefined);
    try {
      await executeEmailFollowup(props.threadId, lastCommand);
    } catch {
      setPending(false);
      setError('Couldn’t save. Your changes are still here; retrying is safe.');
      return;
    }
    setPending(false);
    toast.success(
      command.type === 'remove'
        ? 'Email reminder removed'
        : 'Email reminder updated'
    );
    props.onClose();
  };
  return (
    <Show
      when={query.isSuccess || query.isError}
      fallback={<p role="status">Loading reminder…</p>}
    >
      <Show
        when={followup()?.state === 'pending' ? followup() : undefined}
        fallback={props.children}
      >
        {(current) => (
          <>
            <div class="mb-4">
              <ItemPreview id={props.threadId} type="email" />
            </div>
            <EmailReminderForm
              subject={props.reminder.description}
              initialTime={current().remindAt}
              initialCondition={current().condition}
              pending={pending()}
              error={error()}
              onCancel={props.onClose}
              onSave={(at, condition) =>
                void save({
                  type: 'set',
                  operationId: crypto.randomUUID(),
                  expectedRevision: current().revision,
                  remindAt: at.toISOString(),
                  condition,
                })
              }
              onRemove={() =>
                void save({
                  type: 'remove',
                  operationId: crypto.randomUUID(),
                  expectedRevision: current().revision,
                  undo: false,
                })
              }
            />
          </>
        )}
      </Show>
    </Show>
  );
}
