import { PersonaAvatar } from '@app/features/agent-dms/components/persona-avatar';
import { InteractionCard } from '@app/features/agent-interactions/components/InteractionCard';
import type { AgentInteraction } from '@app/features/agent-interactions/context/interaction';
import { createInteractionController } from '@app/features/agent-interactions/primitives/create-interaction-controller';
import { toast } from '@core/component/Toast/Toast';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { firstPartyBotName } from '@queries/bots/first-party-bot-name';
import { useBotProfile } from '@queries/bots/profiles';
import { queryReadyGate } from '@queries/gate';
import { getTypingAgents } from '@queries/messages/typing';
import type { MessagePart } from '@service-agent-fold/generated/types';
import type { MessageParent } from '@service-storage/messages';
import { createSignal, For, Show } from 'solid-js';
import { LiveTail } from './components/live-tail';
import { TypingRow } from './components/typing-row';
import {
  currentStep,
  openReply,
  streamingProse,
  typingLabel,
} from './core/live-reply';
import { createLiveSession } from './queries/live-session';

/**
 * Agents typing in one place of a conversation - the timeline, or one
 * thread - each as a typing row. A viewer who can read the session also sees
 * the turn as it runs beneath it: the passage being written, what it is
 * waiting on, and Stop.
 */
export function AgentTyping(props: {
  parent: MessageParent;
  threadId: string | null;
}) {
  const typing = () => getTypingAgents(props.parent, props.threadId);
  return (
    <For each={[...typing().keys()]}>
      {(botUserId) => (
        <Show when={typing().get(botUserId)}>
          {(info) => (
            <AgentTypingEntry
              botUserId={botUserId}
              sessionId={info().sessionId}
              phase={info().phase}
            />
          )}
        </Show>
      )}
    </For>
  );
}

function AgentTypingEntry(props: {
  botUserId: string;
  sessionId: string;
  phase: 'thinking' | 'writing' | 'working' | 'waiting';
}) {
  const botId = () => props.botUserId.replace(/^bot\|/, '');
  const firstParty = () => firstPartyBotName(botId());
  const profile = useBotProfile(() => (firstParty() ? '' : botId()));
  // Undefined while the profile loads: the row shows only its dots rather
  // than a placeholder name that changes a moment later.
  const name = () => {
    const known = firstParty();
    if (known) return known;
    if (queryReadyGate(profile)) return profile.data?.name ?? 'Agent';
    return profile.isError ? 'Agent' : undefined;
  };
  const avatarUrl = () =>
    queryReadyGate(profile) ? profile.data?.avatarUrl : undefined;
  const label = () => {
    const known = name();
    return known ? typingLabel(known, props.phase) : '';
  };

  const live = createLiveSession(() => props.sessionId);
  const sessionQuery = useAgentSessionQuery(() => props.sessionId);
  const canEdit = () =>
    queryReadyGate(sessionQuery) ? sessionQuery.data?.canEdit : undefined;
  const reply = () => (live.loaded() ? openReply(live.messages()) : undefined);
  // A held tool call is answered from the session, not here: a turn the
  // owner prompts, as every DM turn is, is never held for them.
  const pending = () =>
    (live.metadata()?.pendingInteractions ?? []).filter(
      (request): request is AgentInteraction =>
        request.kind !== 'tool_approval' && request.turn === reply()?.turn
    );
  const interactions = createInteractionController({
    sessionId: () => props.sessionId,
    pending,
    canEdit,
    issue: (action) => live.issue(action),
    onFailure: (message) => toast.failure(message),
  });
  const toolFor = (toolCall: string | null) => {
    const part = reply()?.parts.find(
      (candidate): candidate is Extract<MessagePart, { kind: 'tool_use' }> =>
        candidate.kind === 'tool_use' && candidate.id === toolCall
    );
    return part;
  };
  const [stopping, setStopping] = createSignal(false);
  const stop = async () => {
    setStopping(true);
    const result = await live.issue({ type: 'stop' });
    if (result?.isErr()) toast.failure('The agent could not be stopped');
    setStopping(false);
  };

  return (
    <TypingRow
      avatar={
        <PersonaAvatar
          botId={botId()}
          name={name() ?? ''}
          avatarUrl={avatarUrl()}
          size="sm"
        />
      }
      label={label()}
      step={(() => {
        const open = reply();
        return open && props.phase === 'working'
          ? currentStep(open)
          : undefined;
      })()}
    >
      <Show when={reply() || live.failed()}>
        <LiveTail
          prose={reply() ? streamingProse(reply()!) : undefined}
          disconnected={live.failed()}
          onReconnect={live.retry}
          onStop={canEdit() && reply() ? () => void stop() : undefined}
          stopping={stopping()}
        >
          <For each={pending()}>
            {(request) => (
              <InteractionCard
                request={request}
                controller={interactions}
                tool={toolFor(request.toolCall)}
              />
            )}
          </For>
        </LiveTail>
      </Show>
    </TypingRow>
  );
}
