import { draftQueueActive } from '@queries/email/draft-queue';
import { useQueuedEmailSends } from '@queries/email/queued-sends';
import {
  cancelEmailSendQueued,
  type EmailSendIntent,
  emailSendLocked,
  restoreCancelledEmailSend,
  settledSendAttempt,
} from '@queries/email/send-queue';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';

/** App-facing persistent send status, shared by Drafts and conversation hosts. */
export function QueuedSendStatus(props: {
  threadId?: string;
  inboxIds?: readonly string[];
}) {
  const sends = useQueuedEmailSends(() => draftQueueActive());
  const visible = () =>
    sends.intents().filter((intent) => {
      const { draft, input } = intent.metadata.payload;
      const attempt = settledSendAttempt(intent);
      return (
        !(intent.metadata.payload.restoring && intent.phase === 'committed') &&
        attempt?.status !== 'SENT' &&
        (!props.threadId ||
          intent.resolvedThreadId === props.threadId ||
          draft.threadDbId === props.threadId ||
          attempt?.threadId === props.threadId) &&
        (!props.inboxIds?.length ||
          props.inboxIds.includes(String(input.attempt.linkId)))
      );
    });
  return (
    <Show when={visible().length > 0}>
      <div
        class="shrink-0 border-b border-edge-muted p-3"
        aria-label="Queued email sends"
      >
        <For each={visible()}>
          {(intent) => (
            <SendStatus intent={intent} refresh={() => sends.refresh(true)} />
          )}
        </For>
      </div>
    </Show>
  );
}

function SendStatus(props: {
  intent: EmailSendIntent;
  refresh: () => Promise<void>;
}) {
  const [working, setWorking] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const status = () => settledSendAttempt(props.intent)?.status;
  const label = () => {
    if (props.intent.metadata.payload.restoring)
      return props.intent.phase === 'failed'
        ? 'Draft restoration needs attention. Your message is saved here.'
        : 'Restoring draft';
    if (!emailSendLocked(props.intent)) return 'Send cancelled';
    if (status() === 'DELIVERY_UNCONFIRMED')
      return 'Delivery unconfirmed. Your email may already have been sent. Check your sent mail. We will not resend automatically.';
    if (status() === 'FAILED')
      return 'Send failed before delivery. Cancel to recover this draft.';
    if (props.intent.phase === 'failed')
      return 'Send needs attention. Cancel to recover this draft.';
    if (
      emailSendLocked(props.intent) &&
      props.intent.metadata.replace &&
      props.intent.phase === 'pending'
    )
      return 'Cancellation pending';
    if (status() === 'ACCEPTED') return 'Queued to send';
    if (status() === 'SENDING' || props.intent.phase === 'committed')
      return 'Sending';
    return 'Queued to send';
  };
  const cancel = async () => {
    setWorking(true);
    setError(undefined);
    try {
      if (emailSendLocked(props.intent))
        await cancelEmailSendQueued(props.intent);
      else await restoreCancelledEmailSend(props.intent);
      await props.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to cancel the send'
      );
    } finally {
      setWorking(false);
    }
  };
  const checkStatus = async () => {
    setWorking(true);
    setError(undefined);
    try {
      await props.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to check send status'
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <div class="flex items-start justify-between gap-3 py-1">
      <div class="min-w-0">
        <div class="truncate text-sm text-ink">
          {props.intent.metadata.payload.draft.subject || '(No subject)'}
        </div>
        <div class="text-xs text-ink-muted" role="status">
          {label()}
        </div>
        <Show when={error()}>
          <div class="text-xs text-ink" role="alert">
            {error()}
          </div>
        </Show>
        <Show when={props.intent.phase === 'failed'}>
          <details class="text-xs text-ink-muted">
            <summary>View saved message</summary>
            <div>
              {props.intent.metadata.payload.input.message.to
                ?.map((contact) => contact.email)
                .join(', ')}
            </div>
            <pre class="whitespace-pre-wrap">
              {props.intent.metadata.payload.input.restoreBodyText ??
                props.intent.metadata.payload.input.message.bodyText}
            </pre>
          </details>
        </Show>
      </div>
      <Show
        when={
          status() !== 'SENDING' &&
          status() !== 'DELIVERY_UNCONFIRMED' &&
          !(
            props.intent.metadata.payload.restoring &&
            props.intent.phase === 'pending'
          )
        }
      >
        <Button
          disabled={
            working() ||
            (emailSendLocked(props.intent) &&
              props.intent.metadata.replace &&
              props.intent.phase === 'pending')
          }
          onClick={() => void cancel()}
        >
          {emailSendLocked(props.intent) ? 'Cancel' : 'Restore draft'}
        </Button>
      </Show>
      <Show when={status() === 'DELIVERY_UNCONFIRMED'}>
        <Button disabled={working()} onClick={() => void checkStatus()}>
          Check status
        </Button>
      </Show>
    </div>
  );
}
