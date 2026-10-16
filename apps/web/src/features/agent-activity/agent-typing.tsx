import { PersonaAvatar } from '@app/features/agent-dms/components/persona-avatar';
import { InteractionCard } from '@app/features/agent-interactions/components/InteractionCard';
import type { AgentInteraction } from '@app/features/agent-interactions/context/interaction';
import { createInteractionController } from '@app/features/agent-interactions/primitives/create-interaction-controller';
import {
  isWorkingTurn,
  sessionTurn,
  subscribeSessionTurns,
} from '@core/agent-session/session-turn';
import { toast } from '@core/component/Toast/Toast';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { firstPartyBotName } from '@queries/bots/first-party-bot-name';
import { useBotProfile } from '@queries/bots/profiles';
import { queryReadyGate } from '@queries/gate';
import { parentKey } from '@queries/messages/keys';
import { getTypingAgents, type TypingAgent } from '@queries/messages/typing';
import type { MessagePart } from '@service-agent-fold/generated/types';
import type { MessageParent } from '@service-storage/messages';
import { Key } from '@solid-primitives/keyed';
import {
  createContext,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { LiveTail } from './components/live-tail';
import { TypingRow } from './components/typing-row';
import { openReply, streamingProse, typingLabel } from './core/live-reply';
import { createLiveSession } from './queries/live-session';

/** One place of a conversation: the timeline, or one thread. */
type TypingPlace = { parent: MessageParent; threadId: string | null };

const KeptRowsContext = createContext<{
  shows: (place: TypingPlace) => boolean;
  rows: JSX.Element;
}>();

/**
 * Agents typing in one place of a conversation - the timeline, or one
 * thread - each as a typing row. A viewer who can read the session also sees
 * the turn as it runs beneath it: the passage being written, what it is
 * waiting on, and Stop.
 *
 * Under an {@link AgentTypingProvider} for the same place, these are the
 * provider's rows, moved here.
 */
export function AgentTyping(props: TypingPlace) {
  const kept = useContext(KeptRowsContext);
  return (
    <Show
      when={kept?.shows(props)}
      fallback={
        <AgentTypingRows parent={props.parent} threadId={props.threadId} />
      }
    >
      {kept?.rows}
    </Show>
  );
}

/**
 * Makes one place's typing rows once, for a list that shows them under
 * whichever of its rows is newest: a row that changes when a message
 * arrives, and that a virtualized list unmounts once the reader scrolls
 * away. Rows made inside it would go with it - the turn's live view would
 * load again, and every card beneath it would start over, dropping an
 * answer or a draft the viewer had half written. Made here, the rows outlive
 * the list's rows and only move between them.
 */
export function AgentTypingProvider(props: ParentProps<TypingPlace>) {
  // A boundary of their own: rows that suspend must not blank the list.
  const rows = (
    <Suspense>
      <AgentTypingRows parent={props.parent} threadId={props.threadId} />
    </Suspense>
  );
  return (
    <KeptRowsContext.Provider
      value={{
        shows: (place) =>
          place.threadId === props.threadId &&
          parentKey(place.parent) === parentKey(props.parent),
        rows,
      }}
    >
      {props.children}
    </KeptRowsContext.Provider>
  );
}

function AgentTypingRows(props: TypingPlace) {
  const [turns, setTurns] = createSignal(0);
  onCleanup(subscribeSessionTurns(() => setTurns((count) => count + 1)));
  // Typing lapses whenever its heartbeat does, as when a phone sleeps with
  // the app open. An agent whose turn the fold still has open - working, or
  // waiting on the viewer - keeps its row until the turn ends, and with it
  // whatever the viewer was answering beneath it.
  const agents = createMemo<ReadonlyMap<string, TypingAgent>>((shown) => {
    turns();
    const next = new Map(getTypingAgents(props.parent, props.threadId));
    for (const [botUserId, agent] of shown) {
      const turn = sessionTurn(agent.sessionId);
      if (!next.has(botUserId) && (isWorkingTurn(turn) || turn === 'blocked'))
        next.set(botUserId, agent);
    }
    return next;
  }, new Map());
  return (
    <For each={[...agents().keys()]}>
      {(botUserId) => (
        <Show when={agents().get(botUserId)}>
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
    try {
      const result = await live.issue({ type: 'stop' });
      if (result?.isErr()) toast.failure('The agent could not be stopped');
    } catch {
      toast.failure('The agent could not be stopped');
    } finally {
      setStopping(false);
    }
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
    >
      <Show when={reply() || live.failed()}>
        <LiveTail
          prose={reply() ? streamingProse(reply()!) : undefined}
          disconnected={live.failed()}
          onReconnect={live.retry}
          onStop={canEdit() && reply() ? () => void stop() : undefined}
          stopping={stopping()}
        >
          {/* Each metadata event carries every request anew. Keyed by what
              it asks, a card keeps whatever was typed into it. */}
          <Key
            each={pending()}
            by={(request) =>
              JSON.stringify([request.turn, request.kind, request.requestId])
            }
          >
            {(request) => (
              <InteractionCard
                request={request()}
                controller={interactions}
                tool={toolFor(request().toolCall)}
              />
            )}
          </Key>
        </LiveTail>
      </Show>
    </TypingRow>
  );
}
