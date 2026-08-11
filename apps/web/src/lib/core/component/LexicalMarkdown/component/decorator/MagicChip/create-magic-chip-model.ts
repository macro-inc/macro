import { type MessageId, withAuthor } from '@core/agent-fold/message-id';
import type { FoldedMessage } from '@core/agent-fold/types';
import type { MagicChipDecoratorProps } from '@macro-inc/lexical-core';
import { subscribeAgentSessionLog } from '@queries/channel/agent-session-stream';
import {
  createFoldedMessages,
  type FoldedMessageLookup,
} from '@queries/channel/folded-messages';
import type { AgentSessionLogEntryDto } from '@service-storage/generated/schemas/agentSessionLogEntryDto';
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

function responseFromPrompt(
  lookup: FoldedMessageLookup | undefined,
  sessionId: string,
  prompt: MessageId
): FoldedMessage | undefined {
  if (!lookup || prompt.author !== 'user') return undefined;
  return lookup(sessionId, withAuthor(prompt, 'agent'));
}

/** Own the live fold and lifecycle subscriptions behind one Magic Chip. */
export function createMagicChipModel(props: MagicChipDecoratorProps): {
  presentation: Accessor<MagicChipPresentation>;
} {
  const [latestEvent, setLatestEvent] = createSignal<string>();
  const observeEntries = (entries: AgentSessionLogEntryDto[]) => {
    // A live event is newer than the fetched snapshot that was in flight.
    if (latestEvent()) return;
    for (const entry of entries) {
      const event = systemEvent(entry);
      if (event) setLatestEvent(event);
    }
  };
  // Always on: a chip that exists in a document has to render its session
  // regardless of whether the channel surfaces the fold.
  const foldedMessages = createFoldedMessages(
    () => props.channelId,
    () => true,
    { observeEntries }
  );
  const unsubscribe = subscribeAgentSessionLog(
    props.agentSessionId,
    (event) => {
      const name = systemEvent(event);
      if (name) setLatestEvent(name);
    }
  );
  onCleanup(unsubscribe);

  // Unlike a direct resource read, this does not suspend the initial status.
  const lookup = () =>
    foldedMessages.state === 'ready' ? foldedMessages() : undefined;
  const presentation = () =>
    deriveMagicChipPresentation({
      persistedStatus: props.status,
      latestEvent: latestEvent(),
      prompt: lookup()?.(props.agentSessionId, props.promptedMessage),
      response: responseFromPrompt(
        lookup(),
        props.agentSessionId,
        props.promptedMessage
      ),
    });

  return { presentation };
}
