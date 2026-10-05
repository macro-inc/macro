import {
  harnessDisplayName,
  harnessTitle,
  modelDisplayName,
  sessionHarnessSlug,
} from '@app/features/block-agent/component/compose-agent-session-options';
import {
  toolCallDetail,
  toolLabel,
} from '@app/features/block-agent/component/parts/shared';
import type { InteractionController } from '@app/features/block-agent/context/interaction';
import { createInteractionController } from '@app/features/block-agent/primitives/create-interaction-controller';
import { AgentSession } from '@core/agent-session/AgentSession';
import { toast } from '@core/component/Toast/Toast';
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
  type MagicChipInteraction,
  type MagicChipPresentation,
} from './presentation';
import {
  peekResolvedMagicChip,
  readResolvedMagicChip,
  rememberResolvedMagicChip,
  resolvedMagicChipStoreAvailable,
} from './resolved-cache';

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
 * The persona as the header names it: the runtime's product name, with
 * "Agent" appended when that name does not already end in it (`Macro Agent`,
 * `Cursor Agent`). A titled slug for a runtime the composer does not name.
 */
function agentName(session: {
  harness?: string;
  botId?: string;
}): string | undefined {
  const harness = sessionHarnessSlug(session);
  if (!harness) return undefined;
  const known = harnessDisplayName(harness);
  const base = known === harness ? harnessTitle(harness) : known;
  return base.endsWith(' Agent') ? base : `${base} Agent`;
}

/**
 * The model's display name from the fold, or the one the session was created
 * with before the fold reports.
 */
function modelName(
  metadata: SessionMetadata | undefined,
  session: SessionIdentity | undefined
): string | undefined {
  const model = metadata?.model || session?.model;
  if (!model) return undefined;
  return modelDisplayName(model, metadata?.supportedModels ?? []);
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
 * row reports edit access, and the shared interaction controller sends the answer.
 * The header names the persona and model from the session row and the fold.
 *
 * The fold is the shared {@link AgentSession} for the id, so a chip and a
 * block showing the same session fold it once between them. A turn that has
 * settled is remembered. An anchored chip for a turn already resolved renders
 * that passage and does not fetch or refold the log. A chip that follows the
 * latest turn stays on the live session, because another turn can still start.
 */
export function createMagicChipModel(props: MagicChipData): {
  presentation: Accessor<MagicChipPresentation>;
  header: Accessor<MagicChipHeader | undefined>;
  interactions: InteractionController;
  loading: Accessor<boolean>;
} {
  const [loading, setLoading] = createSignal(true);
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  /** Settled passage restored from the cache, before any fold. */
  const [cachedMarkdown, setCachedMarkdown] = createSignal<string>();
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
  const pending = () => metadata()?.pendingInteractions ?? [];
  // The last system event's wire name, which the fold carries as status.
  const latestEvent = () => metadata()?.status ?? undefined;

  // Acquired only when this chip has to fold. A remembered turn never takes
  // a reference, so scrolling it back into view does not reopen the log.
  let live: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
  // A chip scrolled out of a virtualized list mid-load releases the session,
  // which rejects the load or the snapshot. That is not a fault.
  let released = false;

  const applyEvents = (events: FoldedStreamEvent[]) => {
    for (const event of events) {
      if (event.kind === 'replace') setMessages(event.messages);
      else if (event.kind === 'metadata') setMetadata(event.metadata);
      else setMessages((current) => upsert(current, event.message));
    }
    rememberSettledTurn();
  };

  async function loadSession() {
    const current = live;
    if (!current) return;
    try {
      await current.load();
      if (released) return;

      const snapshot = await current.snapshot();
      if (released) return;

      setMessages(snapshot.messages);
      setMetadata(snapshot.metadata);
      rememberSettledTurn();
    } catch (error: unknown) {
      if (!released) {
        console.error('[magic-chip] session log could not be folded', error);
      }
    } finally {
      if (!released) setLoading(false);
    }
  }

  function attachLive(): AgentSession | undefined {
    if (released) return undefined;
    if (live) return live;
    const sessionLive = AgentSession.acquire(props.agentSessionId);
    live = sessionLive;
    unsubscribe = sessionLive.subscribe(applyEvents);
    void loadSession();
    return sessionLive;
  }

  onCleanup(() => {
    released = true;
    unsubscribe?.();
    live?.release();
  });

  // Fold patches can arrive out of order. Follow the highest turn, including
  // a pending question whose metadata arrives before its message patch.
  const turn = () =>
    props.promptedMessage?.turn ??
    messages().reduce(
      (latest, message) => Math.max(latest, message.turn),
      pending().reduce((latest, request) => Math.max(latest, request.turn), 0)
    );

  function rememberSettledTurn() {
    const currentTurn = turn();
    const messagesForTurn = messages().filter(
      (message) => message.turn === currentTurn
    );
    // Settled depends on the response's stop, not on lifecycle or questions.
    const derived = deriveMagicChipPresentation({
      persistedStatus: props.status,
      latestEvent: latestEvent(),
      prompt: messagesForTurn.find((message) => message.author.kind === 'user'),
      response: messagesForTurn.find(
        (message) => message.author.kind === 'agent'
      ),
    });
    if (derived.kind !== 'settled') return;
    rememberResolvedMagicChip({
      agentSessionId: props.agentSessionId,
      turn: currentTurn,
      markdown: derived.markdown,
    });
  }

  function adoptResolved(markdown: string) {
    setCachedMarkdown(markdown);
    setLoading(false);
  }

  async function readResolvedOrFold(turnNumber: number) {
    const hit = await readResolvedMagicChip(props.agentSessionId, turnNumber);
    if (released) return;
    if (hit) {
      adoptResolved(hit.markdown);
      return;
    }
    attachLive();
  }

  function boot() {
    const anchored = props.promptedMessage?.turn;
    // An unanchored chip follows the latest turn, which can still move.
    if (anchored === undefined) {
      attachLive();
      return;
    }
    const warm = peekResolvedMagicChip(props.agentSessionId, anchored);
    if (warm) {
      adoptResolved(warm.markdown);
      return;
    }
    // Without IndexedDB, fold immediately. Waiting on a store that cannot
    // exist would only delay the load.
    if (!resolvedMagicChipStoreAvailable()) {
      attachLive();
      return;
    }
    void readResolvedOrFold(anchored);
  }

  // An anchored chip only offers interactions from its own turn.
  const pendingForTurn = () =>
    pending().filter((request) => request.turn === turn());
  const interactions = createInteractionController({
    sessionId: () => props.agentSessionId,
    pending: pendingForTurn,
    canEdit,
    issue: (action) => {
      const sessionLive = attachLive();
      if (!sessionLive) throw new Error('agent session released');
      return sessionLive.issue(action);
    },
    onFailure: toast.failure,
  });
  const asking = (): MagicChipInteraction | undefined => {
    const request = pendingForTurn()[0];
    if (!request) return undefined;
    const tool = messages()
      .find(
        (message) =>
          message.author.kind === 'agent' && message.turn === request.turn
      )
      ?.parts.find(
        (part) => part.kind === 'tool_use' && part.id === request.toolCall
      );
    return {
      request,
      canAnswer: interactions.canAnswer(),
      answering: interactions.answering(request),
      ...(request.kind === 'permission' && tool?.kind === 'tool_use'
        ? {
            action:
              tool.detail.kind === 'terminal'
                ? 'Run command'
                : toolLabel(tool.name),
            detail: toolCallDetail(tool),
          }
        : {}),
    };
  };

  // Before the memo, so a remembered turn's first read is already settled.
  boot();

  // Memoized: the view reads these from many places per flush, and a fold
  // pushes a frame per streamed chunk.
  const presentation = createMemo(() => {
    const currentTurn = turn();
    const messagesForTurn = messages().filter(
      (message) => message.turn === currentTurn
    );
    const remembered = cachedMarkdown();
    if (messagesForTurn.length === 0 && remembered) {
      return { kind: 'settled' as const, markdown: remembered };
    }
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
    const current = session();
    const agent = current ? agentName(current) : undefined;
    const model = modelName(metadata(), session());
    const pullRequestUrl = session()?.pullRequestUrl ?? undefined;
    return agent || model || pullRequestUrl
      ? { agent, model, pullRequestUrl }
      : undefined;
  });

  return { presentation, header, interactions, loading };
}
