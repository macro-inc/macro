import { toast } from '@core/component/Toast/Toast';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useOptionalAgentDm } from './context';
import { useAgentDmControl } from './queries/controls';

/** A context boundary belongs to its first source message, including on reload. */
export function AgentDmContextBoundary(props: { messageId: string }) {
  const context = useOptionalAgentDm();
  const startsContext = () => {
    const data = context?.conversation();
    return data?.segments
      .slice(1)
      .some(
        (segment) =>
          data.turns.find((turn) => turn.sessionId === segment.sessionId)
            ?.sourceMessageId === props.messageId
      );
  };
  return (
    <Show when={startsContext()}>
      <div
        role="separator"
        class="my-5 flex items-center gap-3 text-xs text-ink-muted"
      >
        <span class="h-px flex-1 bg-edge-muted" />
        Fresh context · earlier messages kept
        <span class="h-px flex-1 bg-edge-muted" />
      </div>
    </Show>
  );
}

/** Durable per-message status, with an explicit retry of the exact failed attempt. */
export function AgentDmMessageStatus(props: { messageId: string }) {
  const context = useOptionalAgentDm();
  if (!context) return null;
  const turn = () =>
    context
      .conversation()
      ?.turns.find((turn) => turn.sourceMessageId === props.messageId);
  const retryable = () => {
    const data = context.conversation();
    return (
      data?.available &&
      data.segments.some(
        (segment) =>
          segment.isCurrent && segment.sessionId === turn()?.sessionId
      )
    );
  };
  const failed = () =>
    ['failed', 'stopped', 'interrupted'].includes(turn()?.state ?? '');
  const mutation = useAgentDmControl({
    onSuccess: context.refresh,
    onError: () =>
      toast.failure('Could not retry this message. Refresh and try again.'),
  });
  return (
    <Show when={turn()?.state === 'queued' || failed()}>
      <div
        class="ml-14 flex items-center gap-3 pb-2 text-xs text-ink-muted"
        role="status"
      >
        <span>
          {turn()?.state === 'queued'
            ? 'Queued'
            : turn()?.state === 'interrupted'
              ? 'Interrupted. Review completed actions before retrying.'
              : turn()?.state === 'stopped'
                ? 'Stopped'
                : 'Could not finish this message.'}
        </span>
        <Show when={failed() && retryable()}>
          <Button
            size="xs"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={() => {
              const record = turn();
              const data = context.conversation();
              if (record && data)
                mutation.mutate({
                  type: 'retry',
                  channelId: data.channelId,
                  turn: record,
                });
            }}
          >
            Retry message
          </Button>
        </Show>
      </div>
    </Show>
  );
}
