import { Button } from '@ui';
import { createSignal } from 'solid-js';
import type { MessageOperationSource } from '../../email-message/context/message-operation-source';
import {
  type MessageOperation,
  operationBlocksEditing,
  operationBlocksSending,
} from '../../email-message/core/message-operation';
import { MessageOperationRecovery } from '../../email-message/views/message-operation-recovery';

const scenarios: Record<string, MessageOperation> = {
  uncertain: { state: 'UNCERTAIN', issue: 'SEND_UNKNOWN', revision: '7' },
  transfer: { state: 'CONFLICT', issue: 'MOVE_CONFLICT', revision: '8' },
  conflict: {
    state: 'CONFLICT',
    issue: 'DRAFT_CONFLICT',
    revision: '9',
    remoteVersion: 'mailbox-version',
  },
};

/** Uses the production recovery view and edit/send policy with an injected source. */
export function OutlookRecoveryFixture() {
  const scenario = new URLSearchParams(location.search).get('scenario') ?? '';
  const [operation, setOperation] = createSignal(
    scenarios[scenario] ?? scenarios.uncertain
  );
  const [needsReload, setNeedsReload] = createSignal(false);
  const [body, setBody] = createSignal('Saved Macro draft');
  const [actions, setActions] = createSignal<string[]>([]);
  const source: MessageOperationSource = {
    operation,
    needsReload,
    async resolve(reviewed, action, accepted) {
      setActions((current) => [
        ...current,
        `${action}:${reviewed.revision}:${accepted}`,
      ]);
      if (action === 'recheck') return;
      if (action === 'use_provider') setNeedsReload(true);
      setOperation({
        state: action === 'retry_send' ? 'CONFIRMING' : 'SYNCHRONIZED',
        revision: reviewed.revision,
      });
    },
  };
  return (
    <main class="min-h-screen bg-surface p-4 text-ink">
      <section
        aria-label="Outlook draft recovery"
        class="mx-auto flex max-w-xl flex-col gap-3 border border-edge-muted"
      >
        <MessageOperationRecovery
          source={source}
          onReloadDraft={() => {
            setBody('Latest mailbox draft');
            setNeedsReload(false);
          }}
        />
        <textarea
          aria-label="Message"
          class="m-3 min-h-24 bg-input p-2"
          value={body()}
          disabled={needsReload() || operationBlocksEditing(operation())}
          onInput={(event) => setBody(event.currentTarget.value)}
        />
        <Button disabled={needsReload() || operationBlocksSending(operation())}>
          Send email
        </Button>
        <output data-testid="resolutions">{actions().join(',')}</output>
      </section>
    </main>
  );
}
