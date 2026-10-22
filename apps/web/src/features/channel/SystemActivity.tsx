import { useUserId } from '@core/context/user';
import { getDisplayName, tryMacroId } from '@core/user';
import {
  useChannelAccessRequestQuery,
  useResolveChannelAccessRequestMutation,
} from '@queries/channel/access-requests';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { getBotDisplayName } from '@queries/messages/message-sender';
import type { ChannelAccessDecision } from '@service-storage/generated/schemas/channelAccessDecision';
import { Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import {
  AccessRequestActivityRow,
  type AccessRequestOutcome,
} from './components/AccessRequestActivityRow';
import { SystemActivityRow } from './components/SystemActivityRow';
import type { SystemActivity as SystemActivityEvent } from './core/system-activity';

function name(id: string | null | undefined): string {
  if (!id) return 'Someone';
  return getBotDisplayName(id) || getDisplayName(tryMacroId(id)) || 'Someone';
}

/** App composition uses the same cached principal names as channel messages. */
export function SystemActivity(props: {
  channelId: string;
  event: SystemActivityEvent;
}) {
  const participant = () =>
    'participant' in props.event.action
      ? name(props.event.action.participant)
      : 'a participant';
  const requestId = () =>
    props.event.action.kind === 'access_requested'
      ? props.event.action.requestId
      : undefined;
  return (
    <Switch
      fallback={
        <SystemActivityRow
          event={props.event}
          actorName={name(props.event.actorId)}
          participantName={participant()}
        />
      }
    >
      <Match when={requestId()}>
        {(requestId) => (
          <AccessRequestActivity
            channelId={props.channelId}
            requestId={requestId()}
            event={props.event}
          />
        )}
      </Match>
    </Switch>
  );
}

/** Participants answer a request to join from its timeline entry. */
function AccessRequestActivity(props: {
  channelId: string;
  requestId: string;
  event: SystemActivityEvent;
}) {
  const userId = useUserId();
  const request = useChannelAccessRequestQuery(
    () => props.channelId,
    () => props.requestId
  );
  const participants = useChannelParticipantsQuery(() => props.channelId);
  const resolve = useResolveChannelAccessRequestMutation();
  const isParticipant = () =>
    !participants.isPending &&
    (participants.data ?? []).some(
      (participant) => participant.user_id === userId()
    );
  const outcome = (): AccessRequestOutcome => {
    if (request.isPending) return { kind: 'loading' };
    const current = request.data;
    if (!current) return { kind: 'unavailable' };
    return match(current.status)
      .returnType<AccessRequestOutcome>()
      .with('pending', () => ({
        kind: 'pending',
        canAnswer: isParticipant(),
      }))
      .with('approved', () => ({
        kind: 'approved',
        by: name(current.resolved_by),
      }))
      .with('denied', () => ({ kind: 'denied', by: name(current.resolved_by) }))
      .with('cancelled', () => ({ kind: 'withdrawn' }))
      .exhaustive(() => ({ kind: 'unavailable' }));
  };
  const answer = (decision: ChannelAccessDecision) =>
    resolve.mutate({
      channelId: props.channelId,
      requestId: props.requestId,
      decision,
    });
  return (
    <AccessRequestActivityRow
      eventId={props.event.id}
      occurredAt={props.event.occurredAt}
      requesterName={name(props.event.actorId)}
      outcome={outcome()}
      busy={resolve.isPending}
      onApprove={() => answer('approve')}
      onDeny={() => answer('deny')}
    />
  );
}
