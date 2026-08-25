import {
  MAGIC_CHIP_STATUSES,
  type MagicChipDecoratorProps,
  type MagicChipStatus,
} from '@macro-inc/lexical-core';
import {
  acquireAgentSessionFold,
  subscribeAgentSessionLog,
} from '@queries/agent-session/session-fold';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import type {
  AgentSessionLogEntryDto,
  SessionStatusDto,
} from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import {
  deriveMagicChipPresentation,
  type MagicChipPresentation,
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

/** Observe the session lifecycle and the chip's anchored folded turn. */
export function createMagicChipModel(props: MagicChipDecoratorProps): {
  presentation: Accessor<MagicChipPresentation>;
} {
  const [latestEvent, setLatestEvent] = createSignal<string>();
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  const [persistedStatus, setPersistedStatus] = createSignal(props.status);
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
  })
    .then((acquired) => {
      if (!active) {
        acquired.release();
        return;
      }
      release = acquired.release;
      setMessages(acquired.messages);
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

  const presentation = () => {
    const turn = props.promptedMessage.turn;
    const messagesForTurn = messages().filter(
      (message) => message.turn === turn
    );
    return deriveMagicChipPresentation({
      persistedStatus: persistedStatus(),
      latestEvent: latestEvent(),
      prompt: messagesForTurn.find((message) => message.author.kind === 'user'),
      response: messagesForTurn.find(
        (message) => message.author.kind === 'agent'
      ),
    });
  };

  return { presentation };
}
