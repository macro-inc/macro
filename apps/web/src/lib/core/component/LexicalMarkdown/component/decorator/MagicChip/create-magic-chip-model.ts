import {
  harnessDisplayName,
  harnessTitle,
  modelDisplayName,
} from '@app/features/block-agent/component/compose-agent-session-options';
import {
  createElicitationController,
  type ElicitationController,
} from '@app/features/block-agent/context/create-elicitation-controller';
import { useUserId } from '@core/context/user';
import {
  MAGIC_CHIP_STATUSES,
  type MagicChipDecoratorProps,
  type MagicChipStatus,
} from '@macro-inc/lexical-core';
import {
  acquireAgentSessionFold,
  subscribeAgentSessionLog,
} from '@queries/agent-session/session-fold';
import type {
  FoldedMessage,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentSessionLogEntryDto,
  SessionStatusDto,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';
import {
  deriveMagicChipPresentation,
  type MagicChipHeader,
  type MagicChipPresentation,
  type MagicChipQuestion,
} from './presentation';

const STATUS_POLL_INTERVAL_MS = 5_000;
const MAX_STATUS_POLLS = 120;

function systemEvent(entry: AgentSessionLogEntryDto): string | undefined {
  const content = entry.content;
  return content.type === 'event' && typeof content.event === 'string'
    ? content.event
    : undefined;
}

function magicChipStatus(
  status: SessionStatusDto
): MagicChipStatus | undefined {
  const value = status.kind === 'event' ? status.event : status.kind;
  return MAGIC_CHIP_STATUSES.find((candidate) => candidate === value);
}

/** What the session row says about who runs it, until the fold says more. */
type SessionIdentity = { harness: string; model: string };

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

/**
 * Observe the session lifecycle and the chip's anchored folded turn.
 *
 * Also the chip's half of answering a question the agent stops to ask in
 * that turn: the session's metadata names the live question, the session
 * row names its owner, and {@link ElicitationController} sends the answer.
 * The header names the persona and model from the session row and the fold.
 */
export function createMagicChipModel(props: MagicChipDecoratorProps): {
  presentation: Accessor<MagicChipPresentation>;
  header: Accessor<MagicChipHeader | undefined>;
  elicitation: ElicitationController;
} {
  const [latestEvent, setLatestEvent] = createSignal<string>();
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  const [persistedStatus, setPersistedStatus] = createSignal(props.status);
  const [ownerId, setOwnerId] = createSignal<string>();
  const [session, setSession] = createSignal<SessionIdentity>();
  const [metadata, setMetadata] = createSignal<SessionMetadata>();
  const pendingElicitation = () => metadata()?.pendingElicitation ?? undefined;
  const viewerId = useUserId();
  let active = true;
  let release: (() => void) | undefined;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let statusPolls = 0;
  const unsubscribe = subscribeAgentSessionLog(
    props.agentSessionId,
    (event) => {
      const name = systemEvent(event);
      if (name) setLatestEvent(name);
    }
  );

  const refreshStatus = async () => {
    statusPolls += 1;
    const result = await agentHarnessServiceClient
      .get(props.agentSessionId)
      .catch(() => undefined);
    if (!active) return;
    if (result?.isOk()) {
      setOwnerId(result.value.ownerId);
      setSession({
        harness: result.value.harness,
        model: result.value.model,
      });
    }
    const status = result?.isOk()
      ? magicChipStatus(result.value.status)
      : undefined;
    if (status) setPersistedStatus(status);
    const retry =
      result === undefined || status === 'no_messages' || status === 'booting';
    if (retry && statusPolls < MAX_STATUS_POLLS) {
      statusTimer = setTimeout(refreshStatus, STATUS_POLL_INTERVAL_MS);
    }
  };
  void refreshStatus();

  void acquireAgentSessionFold({
    agentSessionId: props.agentSessionId,
    onReplace: setMessages,
    onChange: (changed) => {
      setMessages((current) =>
        changed.reduce(
          (next, message) => [
            ...next.filter(
              (existing) =>
                existing.turn !== message.turn ||
                existing.author.kind !== message.author.kind
            ),
            message,
          ],
          current
        )
      );
    },
    onMetadata: setMetadata,
  })
    .then((acquired) => {
      if (!active) {
        acquired.release();
        return;
      }
      release = acquired.release;
      setMessages(acquired.messages);
      setMetadata(acquired.metadata);
    })
    .catch((error: unknown) => {
      console.error('[magic-chip] session log could not be folded', error);
    });

  onCleanup(() => {
    active = false;
    clearTimeout(statusTimer);
    unsubscribe();
    release?.();
  });

  // This chip is one turn's surface; only a question asked in that turn is
  // its to offer.
  const questionForTurn = () => {
    const question = pendingElicitation();
    return question?.turn === props.promptedMessage.turn ? question : undefined;
  };
  const elicitation = createElicitationController({
    sessionId: () => props.agentSessionId,
    pending: questionForTurn,
    ownerId,
    viewerId,
  });
  const asking = (): MagicChipQuestion | undefined => {
    const question = questionForTurn();
    if (!question) return undefined;
    return {
      question,
      canAnswer: elicitation.canAnswer(),
      ownerName: elicitation.ownerName(),
    };
  };

  // Memoized: the view reads these from many places per flush, and a fold
  // pushes a frame per streamed chunk.
  const presentation = createMemo(() => {
    const turn = props.promptedMessage.turn;
    const messagesForTurn = messages().filter(
      (message) => message.turn === turn
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
    return agent || model ? { agent, model } : undefined;
  });

  return { presentation, header, elicitation };
}
