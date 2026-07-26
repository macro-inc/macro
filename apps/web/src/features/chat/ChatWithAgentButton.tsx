import { globalSplitManager } from '@app/signal/splitLayout';
import type { BlockAlias, BlockName } from '@core/block';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import type { Attachment } from '@core/component/AI/types';
import {
  type ChatAttachmentMention,
  chatAttachmentMentionToAttachment,
  chatAttachmentMentionToMarkdown,
} from '@core/component/AI/util/chatAttachmentMention';
import { storeChatStateImmediate } from '@core/component/AI/util/storage';
import { toast } from '@core/component/Toast/Toast';
import { createChat } from '@core/util/create';
import { AnimatedStarIcon } from '@icon/wide-star';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import { match } from 'ts-pattern';

export { AnimatedStarIcon as ChatWithAgentIcon };

type ChatWithAgentEntity =
  | { type: 'email'; id: string; name: string }
  | {
      type: 'document';
      id: string;
      name: string;
      blockName: BlockName | BlockAlias;
    }
  | { type: 'project'; id: string; name: string }
  | { type: 'channel'; id: string; name: string; channelType: ChannelType };

function buildMention(entity: ChatWithAgentEntity): ChatAttachmentMention {
  return match(entity)
    .with({ type: 'email' }, (e) => ({
      documentId: e.id,
      documentName: e.name,
      blockName: 'email',
    }))
    .with({ type: 'document' }, (e) => ({
      documentId: e.id,
      documentName: e.name,
      blockName: e.blockName,
    }))
    .with({ type: 'project' }, (e) => ({
      documentId: e.id,
      documentName: e.name,
      blockName: 'project',
    }))
    .with({ type: 'channel' }, (e) => ({
      documentId: e.id,
      documentName: e.name,
      blockName: 'channel',
      channelType: e.channelType,
    }))
    .exhaustive();
}

async function createAndOpenChat(seed: {
  input?: string;
  attachments?: Attachment[];
  /** When set, sent immediately when the chat opens instead of seeding the input */
  message?: string;
}) {
  const result = await createChat();
  if ('error' in result || !result.chatId) {
    console.warn('createAndOpenChat: createChat failed', result);
    toast.failure('Unable to start chat');
    return;
  }

  const { message, ...stored } = seed;
  if (message) {
    setPendingSendData({
      content: message,
      attachments: seed.attachments ?? [],
      model: DEFAULT_MODEL,
    });
  } else {
    storeChatStateImmediate(result.chatId, stored);
  }
  globalSplitManager()?.openWithSplit(
    { type: 'chat', id: result.chatId },
    { activate: true, preferNewSplit: true }
  );
}

export async function openChatWithAgent(entity: ChatWithAgentEntity) {
  const mention = buildMention(entity);
  const attachment = chatAttachmentMentionToAttachment(mention);
  const input = chatAttachmentMentionToMarkdown(mention);
  await createAndOpenChat({ input, attachments: [attachment] });
}

export async function openChatWithInput(initialInput: string) {
  await createAndOpenChat({ input: initialInput });
}

/** Open a new chat and immediately send `message` (the chat picks it up via pending send) */
export async function openChatWithMessage(message: string) {
  await createAndOpenChat({ message });
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

export function AskMacroButton(props: { entity: ChatWithAgentEntity }) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      onClick={() => openChatWithAgent(props.entity)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      variant="ghost"
      size="sm"
      depth={2}
      class="gap-1.5 rounded-full px-2 ring ring-edge-muted"
    >
      <AnimatedStarIcon triggerAnimation={hovering()} />
      <span class="text-xs font-medium">Ask Macro</span>
    </Button>
  );
}
