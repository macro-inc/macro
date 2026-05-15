import { globalSplitManager } from '@app/signal/splitLayout';
import type { Attachment } from '@core/component/AI/types';
import { storeChatStateImmediate } from '@core/component/AI/util/storage';
import { toast } from '@core/component/Toast/Toast';
import { createChat } from '@core/util/create';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';

export { AnimatedStarIcon as ChatWithAgentIcon };

const CHANNEL_TYPE_VALUES = new Set<string>(Object.values(ChannelType));

export function toChatChannelType(
  t: string | undefined | null
): ChannelType | undefined {
  if (t && CHANNEL_TYPE_VALUES.has(t)) return t as ChannelType;
  return undefined;
}

export type ChatWithAgentEntity =
  | { type: 'email'; id: string; name: string }
  | {
      type: 'document';
      id: string;
      name: string;
      fileType: string | null | undefined;
    }
  | { type: 'project'; id: string; name: string }
  | { type: 'channel'; id: string; name: string; channelType: ChannelType };

function buildAttachment(entity: ChatWithAgentEntity): Attachment | undefined {
  return match(entity)
    .with({ type: 'email' }, (e) => ({
      entity_id: e.id,
      entity_type: 'email_thread' as const,
    }))
    .with({ type: 'document' }, (e) => ({
      entity_id: e.id,
      entity_type: 'document' as const,
    }))
    .with({ type: 'project' }, (e) => ({
      entity_id: e.id,
      entity_type: 'project' as const,
    }))
    .with({ type: 'channel' }, (e) => ({
      entity_id: e.id,
      entity_type: 'channel' as const,
    }))
    .exhaustive();
}

async function createAndOpenChat(seed: {
  input?: string;
  attachments?: Attachment[];
}) {
  const result = await createChat();
  if ('error' in result || !result.chatId) {
    console.warn('createAndOpenChat: createChat failed', result);
    toast.failure('Unable to start chat');
    return;
  }

  storeChatStateImmediate(result.chatId, seed);
  globalSplitManager()?.openWithSplit(
    { type: 'chat', id: result.chatId },
    { activate: true, preferNewSplit: true }
  );
}

export async function openChatWithAgent(entity: ChatWithAgentEntity) {
  const attachment = buildAttachment(entity);
  if (!attachment) {
    console.warn('openChatWithAgent: unable to build attachment', entity);
    toast.failure("Can't attach this item to a chat");
    return;
  }
  await createAndOpenChat({ attachments: [attachment] });
}

export async function openChatWithInput(initialInput: string) {
  await createAndOpenChat({ input: initialInput });
}

export function ChatWithAgentButton(props: { entity: ChatWithAgentEntity }) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      tooltip="Chat with Agent"
      variant="base"
      size="sm"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={() => openChatWithAgent(props.entity)}
      depth={2}
      class="bg-surface"
    >
      <AnimatedStarIcon triggerAnimation={hovering()} />
      <span class="text-xs">Chat</span>
    </Button>
  );
}
