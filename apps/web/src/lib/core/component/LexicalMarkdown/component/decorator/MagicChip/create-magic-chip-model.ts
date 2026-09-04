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
  PendingElicitation,
} from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentSessionLogEntryDto,
  SessionStatusDto,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import {
  deriveMagicChipPresentation,
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

/**
 * Observe the session lifecycle and the chip's anchored folded turn.
 *
 * Also the chip's half of answering a question the agent stops to ask in
 * that turn: the session's metadata names the live question, the session
 * row names its owner, and {@link ElicitationController} sends the answer.
 */
export function createMagicChipModel(props: MagicChipDecoratorProps): {
  presentation: Accessor<MagicChipPresentation>;
  elicitation: ElicitationController;
} {
  const [latestEvent, setLatestEvent] = createSignal<string>();
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  const [persistedStatus, setPersistedStatus] = createSignal(props.status);
  const [ownerId, setOwnerId] = createSignal<string>();
  const [pendingElicitation, setPendingElicitation] =
    createSignal<PendingElicitation>();
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
    if (result?.isOk()) setOwnerId(result.value.ownerId);
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
    onMetadata: (metadata) => {
      setPendingElicitation(metadata.pendingElicitation ?? undefined);
    },
  })
    .then((acquired) => {
      if (!active) {
        acquired.release();
        return;
      }
      release = acquired.release;
      setMessages(acquired.messages);
      setPendingElicitation(acquired.metadata.pendingElicitation ?? undefined);
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

  const presentation = () => {
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
  };

  return { presentation, elicitation };
}
