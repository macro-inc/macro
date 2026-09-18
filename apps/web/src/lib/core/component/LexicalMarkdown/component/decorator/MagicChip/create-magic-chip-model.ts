import {
  harnessDisplayName,
  harnessTitle,
  modelDisplayName,
} from '@app/features/block-agent/component/compose-agent-session-options';
import {
  createElicitationController,
  type ElicitationController,
} from '@app/features/block-agent/context/create-elicitation-controller';
import { AgentSession } from '@core/agent-session/AgentSession';
import {
  MAGIC_CHIP_STATUSES,
  type MagicChipData,
  type MagicChipStatus,
} from '@macro-inc/lexical-core';
import { useAgentSessionQuery } from '@queries/agent-session/session';
import { queryReadyGate } from '@queries/gate';
import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type { SessionStatusDto } from '@service-agent-harness/generated/schemas';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  deriveMagicChipPresentation,
  type MagicChipHeader,
  type MagicChipPresentation,
  type MagicChipQuestion,
} from './presentation';

function magicChipStatus(
  status: SessionStatusDto
): MagicChipStatus | undefined {
  const value = status.kind === 'event' ? status.event : status.kind;
  return MAGIC_CHIP_STATUSES.find((candidate) => candidate === value);
}

/** What the session row says about who runs it, until the fold says more. */
type SessionIdentity = {
  harness: string;
  model: string;
  pullRequestUrl?: string | null;
};

/**
 * The persona as the header names it: the runtime's product name followed
 * by "Agent" (`Macro Agent`, `Cursor Agent`), a titled slug for a runtime
 * the composer does not name.
 */
function agentName(harness: string | undefined): string | undefined {
  if (!harness) return undefined;
  const known = harnessDisplayName(harness);
  return `${known === harness ? harnessTitle(harness) : known} Agent`;
}

/**
 * The model's display name from the fold, its id when the runtime lists no
 * name, or the slug the session was created with before the fold reports.
 */
function modelName(
  metadata: SessionMetadata | undefined,
  session: SessionIdentity | undefined
): string | undefined {
  const model = metadata?.model;
  if (!model) return session?.model || undefined;
  return modelDisplayName(model, metadata.supportedModels);
}

/** Replace the message under the same turn and author, or append it. */
function upsert(
  current: FoldedMessage[],
  message: FoldedMessage
): FoldedMessage[] {
  return [
    ...current.filter(
      (existing) =>
        existing.turn !== message.turn ||
        existing.author.kind !== message.author.kind
    ),
    message,
  ];
}

/**
 * Observe the session lifecycle and the chip's anchored folded turn.
 *
 * Also the chip's half of answering a question the agent stops to ask in
 * that turn: the session's metadata names the live question, the session
 * row names its owner, and {@link ElicitationController} sends the answer.
 * The header names the persona and model from the session row and the fold.
 *
 * The fold is the shared {@link AgentSession} for the id, so a chip and a
 * block showing the same session fold it once between them.
 */
export function createMagicChipModel(props: MagicChipData): {
  presentation: Accessor<MagicChipPresentation>;
  header: Accessor<MagicChipHeader | undefined>;
  elicitation: ElicitationController;
} {
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  const sessionQuery = useAgentSessionQuery(() => props.agentSessionId);
  // Guard pending data so a cold query cannot suspend the surrounding editor.
  const session = () =>
    queryReadyGate(sessionQuery) ? sessionQuery.data : undefined;
  const canEdit = () => session()?.canEdit;
  const persistedStatus = () => {
    const status = session()?.status;
    return (status ? magicChipStatus(status) : undefined) ?? props.status;
  };
  const [metadata, setMetadata] = createSignal<SessionMetadata>();
  const pendingElicitation = () => metadata()?.pendingElicitation ?? undefined;
  // The last system event's wire name, which the fold carries as status.
  const latestEvent = () => metadata()?.status ?? undefined;

  const live = AgentSession.acquire(props.agentSessionId);
  const applyEvents = (events: FoldedStreamEvent[]) => {
    for (const event of events) {
      if (event.kind === 'replace') setMessages(event.messages);
      else if (event.kind === 'metadata') setMetadata(event.metadata);
      else setMessages((current) => upsert(current, event.message));
    }
  };
  const unsubscribe = live.subscribe(applyEvents);
  void live
    .load()
    .then(() => live.snapshot())
    .then((snapshot) => {
      setMessages(snapshot.messages);
      setMetadata(snapshot.metadata);
    })
    .catch((error: unknown) => {
      console.error('[magic-chip] session log could not be folded', error);
    });

  onCleanup(() => {
    unsubscribe();
    live.release();
  });

  // Fold patches can arrive out of order. Follow the highest turn, including
  // a pending question whose metadata arrives before its message patch.
  const turn = () =>
    props.promptedMessage?.turn ??
    messages().reduce(
      (latest, message) => Math.max(latest, message.turn),
      pendingElicitation()?.turn ?? 0
    );

  // A locked chip only offers questions from its anchored turn.
  const questionForTurn = () => {
    const question = pendingElicitation();
    return question?.turn === turn() ? question : undefined;
  };
  const elicitation = createElicitationController({
    pending: questionForTurn,
    canEdit,
    issue: (action) => live.issue(action),
  });
  const asking = (): MagicChipQuestion | undefined => {
    const question = questionForTurn();
    if (!question) return undefined;
    return {
      question,
      canAnswer: elicitation.canAnswer(),
    };
  };

  // Memoized: the view reads these from many places per flush, and a fold
  // pushes a frame per streamed chunk.
  const presentation = createMemo(() => {
    const currentTurn = turn();
    const messagesForTurn = messages().filter(
      (message) => message.turn === currentTurn
    );
    return deriveMagicChipPresentation({
      persistedStatus: persistedStatus(),
      latestEvent: latestEvent(),
      asking: asking(),
      prompt: messagesForTurn.find((message) => message.author.kind === 'user'),
      response: messagesForTurn.find(
        (message) => message.author.kind === 'agent'
      ),
    });
  });

  const header = createMemo((): MagicChipHeader | undefined => {
    const agent = agentName(session()?.harness);
    const model = modelName(metadata(), session());
    const pullRequestUrl = session()?.pullRequestUrl ?? undefined;
    return agent || model || pullRequestUrl
      ? { agent, model, pullRequestUrl }
      : undefined;
  });

  return { presentation, header, elicitation };
}
