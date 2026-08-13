import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import {
  acquireAgentSessionFold,
  subscribeAgentSessionLog,
} from '@queries/agent-session/session-fold';
import type { FoldedMessage } from '@service-agent-fold/generated/types';
import type { AgentSessionLogEntryDto } from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import {
  deriveMagicChipPresentation,
  type MagicChipPresentation,
} from './presentation';

function systemEvent(entry: AgentSessionLogEntryDto): string | undefined {
  const content = entry.content;
  return content.type === 'event' && typeof content.event === 'string'
    ? content.event
    : undefined;
}

/** Observe the session lifecycle and the chip's anchored folded turn. */
export function createMagicChipModel(props: MagicChipDecoratorProps): {
  presentation: Accessor<MagicChipPresentation>;
} {
  const [latestEvent, setLatestEvent] = createSignal<string>();
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  let active = true;
  let release: (() => void) | undefined;
  const unsubscribe = subscribeAgentSessionLog(
    props.agentSessionId,
    (event) => {
      const name = systemEvent(event);
      if (name) setLatestEvent(name);
    }
  );

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
    unsubscribe();
    release?.();
  });

  const presentation = () => {
    const turn = props.promptedMessage.turn;
    const messagesForTurn = messages().filter(
      (message) => message.turn === turn
    );
    return deriveMagicChipPresentation({
      persistedStatus: props.status,
      latestEvent: latestEvent(),
      prompt: messagesForTurn.find((message) => message.author.kind === 'user'),
      response: messagesForTurn.find(
        (message) => message.author.kind === 'agent'
      ),
    });
  };

  return { presentation };
}
