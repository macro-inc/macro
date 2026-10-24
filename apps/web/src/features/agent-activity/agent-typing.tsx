import { PersonaAvatar } from '@app/features/agent-dms/components/persona-avatar';
import { InteractionCard } from '@app/features/agent-interactions/components/InteractionCard';
import type { AgentInteraction } from '@app/features/agent-interactions/context/interaction';
import {
  createInteractionController,
  interactionKey,
} from '@app/features/agent-interactions/primitives/create-interaction-controller';
import {
  isWorkingTurn,
  sessionTurn,
  subscribeSessionTurns,
} from '@core/agent-session/session-turn';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
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
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
  useContext,
} from 'solid-js';
import { insert } from 'solid-js/web';
import { LiveTail } from './components/live-tail';
import { TypingRow } from './components/typing-row';
import {
  currentStep,
  openReply,
  streamingProse,
  typingLabel,
} from './core/live-reply';
import { createLiveSession } from './queries/live-session';

/** One place of a conversation: the timeline, or one thread. */
type TypingPlace = { parent: MessageParent; threadId: string | null };

const KeptRowsContext = createContext<{
  shows: (place: TypingPlace) => boolean;
  /**
   * Show the rows in `holder` until the returned release is called. The
   * latest holder has them; a released holder's rows go back to the latest
   * one still holding.
   */
  hold: (holder: HTMLElement) => () => void;
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
      when={kept?.shows(props) ? kept : undefined}
      fallback={
        <AgentTypingRows parent={props.parent} threadId={props.threadId} />
      }
    >
      {(keeper) => (
        <div
          class="contents"
          ref={(holder) => onCleanup(keeper().hold(holder))}
        />
      )}
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
 *
 * They move by hand, not as an element two rows insert: a list mounts its
 * new newest row before it lets the old one go, and redraws a row as a
 * message arrives, so for a moment two rows show them. Inserted by both,
 * the old row took them back as it redrew and away with it as it went, and
 * the turn - and whatever it was waiting on - left the page.
 */
export function AgentTypingProvider(props: ParentProps<TypingPlace>) {
  const rows = document.createElement('div');
  rows.className = 'contents';
  // A boundary of their own: rows that suspend must not blank the list.
  insert(
    rows,
    <Suspense>
      <AgentTypingRows parent={props.parent} threadId={props.threadId} />
    </Suspense>
  );
  // The rows that show the turn, latest last.
  const holders: HTMLElement[] = [];
  const hold = (holder: HTMLElement) => {
    holders.push(holder);
    holder.append(rows);
    return () => {
      const at = holders.lastIndexOf(holder);
      if (at >= 0) holders.splice(at, 1);
      const latest = holders.at(-1);
      if (latest && rows.parentNode !== latest) latest.append(rows);
    };
  };
  return (
    <KeptRowsContext.Provider
      value={{
        shows: (place) =>
          place.threadId === props.threadId &&
          parentKey(place.parent) === parentKey(props.parent),
        hold,
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
  const viewer = useUserId();
  const interactions = createInteractionController({
    sessionId: () => props.sessionId,
    pending,
    canEdit,
    issue: (action) => live.issue(action),
    onFailure: (message) => toast.failure(message),
    owns: () => {
      const id = viewer();
      return queryReadyGate(sessionQuery) && id
        ? sessionQuery.data?.ownerId === id
        : undefined;
    },
  });
  const toolFor = (toolCall: string | null) => {
    const part = reply()?.parts.find(
      (candidate): candidate is Extract<MessagePart, { kind: 'tool_use' }> =>
        candidate.kind === 'tool_use' && candidate.id === toolCall
    );
    return part;
  };
  // The run's own wording for the step a request is about.
  const stepFor = (toolCall: string | null) =>
    reply()
      ?.segments.flatMap((segment) => segment.rows)
      .find((row) => row.id === toolCall);
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
          onStop={
            canEdit() && reply()
              ? () => fireAndForget(stop(), 'agent-activity')
              : undefined
          }
          stopping={stopping()}
        >
          {/* Each metadata event carries every request anew. Keyed by what
              it asks, a card keeps whatever was typed into it. */}
          <Key each={pending()} by={interactionKey}>
            {(request) => (
              <InteractionCard
                request={request()}
                controller={interactions}
                tool={toolFor(request().toolCall)}
                step={stepFor(request().toolCall)}
              />
            )}
          </Key>
        </LiveTail>
      </Show>
    </TypingRow>
  );
}
