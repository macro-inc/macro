import { deviceLooksOffline } from '@core/util/connectivity';
import { fireAndForget } from '@core/util/fireAndForget';
import { cancelServerEmailSend } from '@queries/email/cancel-server-send';
import { useQueuedEmailSends } from '@queries/email/queued-sends';
import { emailSendStorageWarning } from '@queries/email/send-intent';
import {
  cancelEmailSendQueued,
  type EmailSendIntent,
  emailSendLocked,
  recoverEmailSendIntent,
  restoreCancelledEmailSend,
  settledSendAttempt,
} from '@queries/email/send-queue';
import {
  hasMoreServerEmailSends,
  loadMoreServerEmailSends,
  refreshServerEmailSends,
  type ServerEmailSend,
  serverEmailSends,
  serverEmailSendsError,
} from '@queries/email/server-sends';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';

/**
 * Routine delivery is silent. A send shows here only while it waits on this
 * device, needs the user, or is scheduled for later.
 */
function sendNeedsNotice(intent: EmailSendIntent, offline: boolean) {
  const status = settledSendAttempt(intent)?.status;
  if (status === 'SENT') return false;
  if (
    intent.metadata.payload.input.message.sendTime ||
    !emailSendLocked(intent) ||
    intent.dispatch?.paused ||
    intent.phase === 'failed' ||
    status === 'FAILED' ||
    status === 'DELIVERY_UNCONFIRMED'
  )
    return true;
  // Delivery and Undo in progress stay silent unless they are stuck.
  if (
    !intent.cancellationRequested &&
    (status === 'ACCEPTED' ||
      status === 'SENDING' ||
      intent.phase === 'committed')
  )
    return false;
  return offline || (intent.dispatch?.failures ?? 0) > 0;
}

/** App-facing persistent send status, shared by Drafts and conversation hosts. */
export function QueuedSendStatus(props: {
  threadId?: string;
  inboxIds?: readonly string[];
}) {
  const sends = useQueuedEmailSends();
  const visible = () =>
    sends.intents().filter((intent) => {
      const { draft, input } = intent.metadata.payload;
      const attempt = settledSendAttempt(intent);
      return (
        sendNeedsNotice(intent, deviceLooksOffline()) &&
        (!props.threadId ||
          intent.resolvedThreadId === props.threadId ||
          draft.threadDbId === props.threadId ||
          attempt?.threadId === props.threadId) &&
        (!props.inboxIds?.length ||
          props.inboxIds.includes(String(input.attempt.linkId)))
      );
    });
  const visibleServer = () =>
    serverEmailSends().filter(
      (row) =>
        !sends
          .intents()
          .some(
            (local) =>
              local.uuid === row.attempt.attemptId &&
              local.metadata.payload.input.attempt.linkId === row.linkId
          ) &&
        (row.attempt.status === 'FAILED' ||
          row.attempt.status === 'DELIVERY_UNCONFIRMED' ||
          (row.attempt.status === 'ACCEPTED' && !!row.attempt.sendTime)) &&
        (!props.threadId || row.attempt.threadId === props.threadId) &&
        (!props.inboxIds?.length || props.inboxIds.includes(row.linkId))
    );
  return (
    <Show
      when={
        visible().length > 0 ||
        visibleServer().length > 0 ||
        serverEmailSendsError() ||
        emailSendStorageWarning()
      }
    >
      {/* Full-frame phone views leave the top inset to their content. This
          panel sits above that content, so it takes the inset in its place. */}
      <div
        class="shrink-0 border-b border-edge-muted p-3 touch:pt-[calc(var(--mobile-content-inset-top,0px)+0.75rem)] touch:[&~*]:[--mobile-content-inset-top:0px]"
        aria-label="Queued email sends"
      >
        <For each={visible()}>
          {(intent) => (
            <SendStatus intent={intent} refresh={() => sends.refresh()} />
          )}
        </For>
        <Show when={emailSendStorageWarning()}>
          <p class="text-xs text-ink-muted" role="alert">
            {emailSendStorageWarning()}
          </p>
        </Show>
        <For each={visibleServer()}>
          {(row) => <ServerSendStatus row={row} />}
        </For>
        <Show when={serverEmailSendsError()}>
          <p class="text-xs text-ink-muted" role="status">
            {serverEmailSendsError()}
          </p>
        </Show>
        <Show when={hasMoreServerEmailSends()}>
          <Button
            onClick={() =>
              fireAndForget(loadMoreServerEmailSends(), 'email-more-sends')
            }
          >
            Load more sends
          </Button>
        </Show>
      </div>
    </Show>
  );
}

function ServerSendStatus(props: { row: ServerEmailSend }) {
  const [working, setWorking] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const status = () => props.row.attempt.status;
  const cancellable = () => status() === 'ACCEPTED' || status() === 'FAILED';
  const action = async () => {
    setWorking(true);
    setError(undefined);
    try {
      if (cancellable()) await cancelServerEmailSend(props.row);
      else await refreshServerEmailSends();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not update delivery status'
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <div class="flex items-start justify-between gap-3 py-1">
      <div class="min-w-0">
        <div class="truncate text-sm text-ink">
          {props.row.attempt.message?.subject || '(No subject)'}
        </div>
        <div class="text-xs text-ink-muted" role="status">
          {status() === 'ACCEPTED'
            ? 'Scheduled'
            : status() === 'FAILED'
              ? 'Send failed before delivery. Cancel to recover this draft.'
              : status() === 'DELIVERY_UNCONFIRMED'
                ? 'Delivery unconfirmed. Check sent mail; we will not resend automatically.'
                : 'Sending'}
          <Show when={props.row.attempt.sendTime}>
            {' · '}
            {new Date(props.row.attempt.sendTime!).toLocaleString()}
          </Show>
        </div>
        <Show when={error()}>
          <p class="text-xs text-ink" role="alert">
            {error()}
          </p>
        </Show>
      </div>
      <Button
        disabled={working()}
        onClick={() => fireAndForget(action(), 'email-server-send')}
      >
        {cancellable() ? 'Cancel and restore' : 'Check status'}
      </Button>
    </div>
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
    if (!emailSendLocked(props.intent)) return 'Send cancelled';
    if (status() === 'DELIVERY_UNCONFIRMED')
      return 'Delivery unconfirmed. Your email may already have been sent. Check your sent mail. We will not resend automatically.';
    if (status() === 'FAILED')
      return 'Send failed before delivery. Cancel to recover this draft.';
    if (props.intent.dispatch?.paused) return props.intent.dispatch.error;
    if (props.intent.phase === 'failed')
      return 'Send needs attention. Cancel to recover this draft.';
    if (emailSendLocked(props.intent) && props.intent.cancellationRequested)
      return 'Cancellation pending';
    if (status() === 'ACCEPTED') return 'Scheduled';
    if (status() === 'SENDING' || props.intent.phase === 'committed')
      return 'Sending';
    return props.intent.submissionStarted
      ? 'Checking server acceptance'
      : 'Queued on this device';
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
      await recoverEmailSendIntent(props.intent);
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
          <Show when={props.intent.metadata.payload.input.message.sendTime}>
            {(sendTime) => <> · {new Date(sendTime()).toLocaleString()}</>}
          </Show>
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
        when={status() !== 'SENDING' && status() !== 'DELIVERY_UNCONFIRMED'}
      >
        <Button
          disabled={
            working() ||
            (emailSendLocked(props.intent) &&
              props.intent.cancellationRequested)
          }
          onClick={() => fireAndForget(cancel(), 'email-compose-cancel-send')}
        >
          {emailSendLocked(props.intent) ? 'Cancel' : 'Restore draft'}
        </Button>
      </Show>
      <Show
        when={
          status() === 'DELIVERY_UNCONFIRMED' || props.intent.dispatch?.paused
        }
      >
        <Button
          disabled={working()}
          onClick={() =>
            fireAndForget(checkStatus(), 'email-compose-check-send')
          }
        >
          Check status
        </Button>
      </Show>
    </div>
  );
}
