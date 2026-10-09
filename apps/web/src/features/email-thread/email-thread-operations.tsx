import type {
  MailboxAction,
  MailboxOperation,
} from '@service-email/generated/schemas';
import { For, Show } from 'solid-js';
import { useThreadOperations } from './queries/thread-operations';

function actionDescription(action: MailboxAction): string {
  switch (action.kind) {
    case 'read':
      return action.value ? 'Mark as read' : 'Mark as unread';
    case 'flagged':
      return action.value ? 'Star messages' : 'Unstar messages';
    case 'archived':
      return action.value ? 'Archive' : 'Restore to Inbox';
    case 'trashed':
      return action.value ? 'Move to Trash' : 'Restore to Inbox';
    case 'junk':
      return action.value ? 'Move to Junk' : 'Restore from Junk';
    case 'category':
      return `${action.value.present ? 'Add' : 'Remove'} category “${action.value.name}”`;
  }
}

/** Organization changes remain visibly pending until provider confirmation. */
export function MailboxOperationsNotice(props: {
  operations: MailboxOperation[];
}) {
  const unresolved = () =>
    props.operations.filter((operation) => operation.state !== 'applied');
  return (
    <Show when={unresolved().length}>
      <div
        class="px-4 py-2 text-xs text-ink-muted border-b border-edge"
        aria-live="polite"
      >
        <For each={unresolved()}>
          {(operation) => (
            <p>
              {actionDescription(operation.action)}:{' '}
              {operation.state === 'pending'
                ? 'Waiting for mailbox confirmation.'
                : 'Could not apply this change. Try the action again.'}
            </p>
          )}
        </For>
      </div>
    </Show>
  );
}

export function EmailThreadOperations(props: {
  threadId: string;
  enabled: boolean;
}) {
  const query = useThreadOperations(
    () => props.threadId,
    () => props.enabled
  );
  return <MailboxOperationsNotice operations={query.data ?? []} />;
}
