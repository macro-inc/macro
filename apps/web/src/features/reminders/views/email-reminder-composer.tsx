import type { EmailEntity } from '@entity';
import {
  executeEmailFollowup,
  useEmailFollowupQuery,
} from '@queries/reminders/email-followup';
import { useMutationUndoContext } from '@queries/undo';
import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import type { EmailFollowupCommand } from '@service-storage/generated/schemas/emailFollowupCommand';
import type { ManagedDialogProps } from '@ui';
import { createSignal } from 'solid-js';
import type { EmailReminderCondition } from '../core/email-reminder';
import { EmailReminderMenu } from './email-reminder-menu';

export function EmailReminderComposer(
  props: ManagedDialogProps & {
    entity: Pick<EmailEntity, 'id' | 'name' | 'type'>;
    onCreated?: () => void | Promise<void>;
  }
) {
  const query = useEmailFollowupQuery(() => props.entity.id);
  const undo = useMutationUndoContext();
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string>();
  // Retain the exact command through retries of an uncertain write.
  let lastCommand: EmailFollowupCommand | undefined;
  let operationSnapshot:
    | { operationId: string; previous: EmailFollowup | null | undefined }
    | undefined;
  const current = () => (query.isSuccess ? query.data : undefined);
  const active = () =>
    current()?.state === 'pending' || current()?.state === 'archiving';
  const submit = async (command: EmailFollowupCommand) => {
    if (pending() || !query.isSuccess) return;
    setPending(true);
    setError(undefined);
    if (operationSnapshot?.operationId !== command.operationId) {
      operationSnapshot = {
        operationId: command.operationId,
        previous: current(),
      };
    }
    // A background read may discover a write whose response was lost. Undo
    // and navigation still belong to the state before that operation began.
    const { previous } = operationSnapshot;
    let result;
    try {
      result = await executeEmailFollowup(
        props.entity.id,
        command,
        async (saved) => {
          if (
            command.type === 'set' &&
            saved.state === 'pending' &&
            previous?.state !== 'pending' &&
            previous?.state !== 'archiving'
          ) {
            await props.onCreated?.();
          }
        }
      );
    } catch {
      setError(
        'Couldn’t confirm the change. Your time is still here; retrying this request is safe.'
      );
      setPending(false);
      return;
    }
    const threadId = props.entity.id;
    setPending(false);
    if (command.type === 'set' && result.state !== 'pending') {
      setError('The reminder was not set. The conversation has been restored.');
      return;
    }
    props.onOpenChange(false);
    const saveUndo = (undoCommand: EmailFollowupCommand) => {
      undo.pushUndo({
        label: 'Email reminder',
        undo: async () => {
          await executeEmailFollowup(threadId, undoCommand);
        },
      });
    };
    if (command.type === 'set' && result.state === 'pending') {
      saveUndo(
        previous?.state === 'pending'
          ? {
              type: 'set',
              operationId: crypto.randomUUID(),
              expectedRevision: result.revision,
              remindAt: previous.remindAt,
              condition: previous.condition,
            }
          : {
              type: 'remove',
              operationId: crypto.randomUUID(),
              expectedRevision: result.revision,
              undo: true,
            }
      );
    } else if (
      command.type === 'remove' &&
      result.state === 'removed' &&
      previous?.state === 'pending'
    ) {
      saveUndo({
        type: 'set',
        operationId: crypto.randomUUID(),
        expectedRevision: null,
        remindAt: previous.remindAt,
        condition: previous.condition,
      });
    }
  };
  const save = (at: Date, condition: EmailReminderCondition) => {
    const values = {
      type: 'set' as const,
      remindAt: at.toISOString(),
      condition,
      expectedRevision: active() ? current()?.revision : undefined,
    };
    if (
      !lastCommand ||
      lastCommand.type !== 'set' ||
      lastCommand.remindAt !== values.remindAt ||
      lastCommand.condition !== condition ||
      ((lastCommand.expectedRevision ?? undefined) !==
        (values.expectedRevision ?? undefined) &&
        current()?.revision !== lastCommand.operationId)
    ) {
      lastCommand = { ...values, operationId: crypto.randomUUID() };
    }
    void submit(lastCommand);
  };
  return (
    <EmailReminderMenu
      open={props.open}
      onOpenChange={(open) => {
        if (!pending()) props.onOpenChange(open);
      }}
      subject={props.entity.name}
      initialTime={active() ? current()?.remindAt : undefined}
      initialCondition={active() ? current()?.condition : undefined}
      pending={pending()}
      ready={query.isSuccess}
      error={query.isError ? 'Couldn’t load this email reminder.' : error()}
      onRetry={query.isError ? () => void query.refetch() : undefined}
      onSave={save}
      onRemove={
        active()
          ? () => {
              const revision = current()?.revision;
              if (!revision) return;
              if (
                !lastCommand ||
                lastCommand.type !== 'remove' ||
                (lastCommand.expectedRevision !== revision &&
                  revision !== lastCommand.operationId)
              ) {
                lastCommand = {
                  type: 'remove',
                  operationId: crypto.randomUUID(),
                  expectedRevision: revision,
                  undo: false,
                };
              }
              void submit(lastCommand);
            }
          : undefined
      }
    />
  );
}
