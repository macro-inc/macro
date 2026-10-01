import { toast } from '@core/component/Toast/Toast';
import type { EntityData } from '@entity';
import {
  executeEmailFollowup,
  useEmailFollowupQuery,
} from '@queries/reminders/email-followup';
import { useMutationUndoContext } from '@queries/undo';
import type { EmailFollowup } from '@service-storage/generated/schemas/emailFollowup';
import type { EmailFollowupCommand } from '@service-storage/generated/schemas/emailFollowupCommand';
import { ActionDialogShell, Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import {
  type EmailReminderCondition,
  EmailReminderForm,
} from '../components/email-reminder-form';
import {
  closeReminderComposer,
  showReminderEntityPicker,
  takeReminderCreatedHandler,
} from '../reminder-composer';

export function EmailReminderComposer(props: {
  entity: EntityData;
  onPending: (pending: boolean) => void;
}) {
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
    if (pending()) return;
    setPending(true);
    props.onPending(true);
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
            await takeReminderCreatedHandler()?.();
          }
        }
      );
    } catch {
      setError(
        'Couldn’t confirm the change. Your time is still here; retrying this request is safe.'
      );
      setPending(false);
      props.onPending(false);
      return;
    }
    takeReminderCreatedHandler();
    const threadId = props.entity.id;
    setPending(false);
    props.onPending(false);
    closeReminderComposer();
    const showUndo = (message: string, undoCommand: EmailFollowupCommand) => {
      const handle = undo.pushUndo({
        label: 'Email reminder',
        undo: async () => {
          await executeEmailFollowup(threadId, undoCommand);
        },
      });
      toast.success(message, {
        actions: [
          {
            label: 'Undo',
            onClick: () =>
              void handle.undo({
                onError: () =>
                  toast.failure(
                    'The reminder changed. Open it to make changes.'
                  ),
              }),
          },
        ],
      });
    };
    if (command.type === 'set' && result.state === 'pending') {
      showUndo(
        'Email reminder set',
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
      showUndo('Email reminder removed', {
        type: 'set',
        operationId: crypto.randomUUID(),
        expectedRevision: null,
        remindAt: previous.remindAt,
        condition: previous.condition,
      });
    } else if (command.type === 'remove') {
      toast.success('Email reminder removed');
    } else if (result.state === 'removed') {
      toast.failure(
        'The reminder was not set. The conversation has been restored.'
      );
    } else if (result.state === 'returned') {
      toast.success(
        'The reminder has already returned this conversation to the inbox'
      );
    } else {
      toast.success('Email reminder cancelled');
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
    <Show
      when={query.isSuccess}
      fallback={
        <ActionDialogShell.Body>
          <ActionDialogShell.Title>Remind me</ActionDialogShell.Title>
          <p role="status">
            {query.isError
              ? 'Couldn’t load this email reminder.'
              : 'Loading reminder…'}
          </p>
          <Show when={query.isError}>
            <Button onClick={() => void query.refetch()}>Retry</Button>
          </Show>
          <Button onClick={closeReminderComposer}>Cancel</Button>
        </ActionDialogShell.Body>
      }
    >
      <EmailReminderForm
        autofocus
        header={
          <ActionDialogShell.Header>
            <div class="flex items-center justify-between gap-3">
              <ActionDialogShell.Title>Remind me</ActionDialogShell.Title>
              <Button
                variant="ghost"
                size="sm"
                disabled={pending()}
                onClick={showReminderEntityPicker}
              >
                Change item
              </Button>
            </div>
            <ActionDialogShell.Description>
              Move this conversation out of the inbox until the selected time.
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
        }
        subject={props.entity.name}
        initialTime={active() ? current()?.remindAt : undefined}
        initialCondition={active() ? current()?.condition : undefined}
        pending={pending()}
        error={error()}
        onSave={save}
        onCancel={closeReminderComposer}
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
                )
                  lastCommand = {
                    type: 'remove',
                    operationId: crypto.randomUUID(),
                    expectedRevision: revision,
                    undo: false,
                  };
                void submit(lastCommand);
              }
            : undefined
        }
      />
    </Show>
  );
}
