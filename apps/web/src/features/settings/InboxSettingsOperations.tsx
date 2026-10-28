import type { MailboxSettingsOperation } from '@service-email/generated/schemas';
import { For, Show } from 'solid-js';
import { useInboxSettingsOperations } from './queries/inbox-settings-operations';

function changeLabel(operation: MailboxSettingsOperation) {
  switch (operation.kind) {
    case 'create_label':
      return `Create label “${operation.resource}”`;
    case 'delete_label':
      return `Delete label “${operation.resource}”`;
    case 'sender_block':
      return `${operation.enabled ? 'Block' : 'Unblock'} ${operation.resource}`;
  }
}

export function InboxSettingsOperations(props: { linkId: string }) {
  const operations = useInboxSettingsOperations(() => props.linkId);
  return (
    <Show when={operations.isSuccess && operations.data.length > 0}>
      <div class="px-6 pb-3 text-xs text-ink-muted" role="status">
        <For each={operations.data}>
          {(operation) => (
            <p>
              {changeLabel(operation)}:{' '}
              {operation.needs_attention
                ? 'Waiting to retry. Check that this inbox is connected and the change is allowed in your mailbox.'
                : 'Waiting for mailbox confirmation.'}
            </p>
          )}
        </For>
      </div>
    </Show>
  );
}
