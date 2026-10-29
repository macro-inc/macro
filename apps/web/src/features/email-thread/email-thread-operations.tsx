import { queryReadyGate } from '@queries/gate';
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

/**
 * Organization changes remain visibly pending until provider confirmation.
 * Opening a thread also marks it read, so a pending mark-as-read is announced
 * only when the user asked for one; its failure is always announced.
 */
export function MailboxOperationsNotice(props: {
  operations: MailboxOperation[];
  announceRead?: boolean;
}) {
  const unresolved = () =>
    props.operations.filter(
      (operation) =>
        operation.state !== 'applied' &&
        !(
          !props.announceRead &&
          operation.state === 'pending' &&
          operation.action.kind === 'read' &&
          operation.action.value
        )
    );
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
  announceRead: boolean;
}) {
  const query = useThreadOperations(
    () => props.threadId,
    () => props.enabled
  );
  // Provider confirmation is supplemental; a cold REST lookup must not
  // suspend the thread body already available from the GraphQL cache.
  return (
    <MailboxOperationsNotice
      operations={queryReadyGate(query) ? query.data : []}
      announceRead={props.announceRead}
    />
  );
}
