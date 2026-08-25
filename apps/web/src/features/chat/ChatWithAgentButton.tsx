import { globalSplitManager } from '@app/signal/splitLayout';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import type { Attachment } from '@core/component/AI/types';
import {
  type ChatAttachmentMention,
  chatAttachmentMentionToMarkdown,
} from '@core/component/AI/util/chatAttachmentMention';
import { storeChatStateImmediate } from '@core/component/AI/util/storage';
import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { createChat } from '@core/util/create';
import { AnimatedStarIcon } from '@icon/wide-star';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { Button } from '@ui';
import { createSignal } from 'solid-js';

export { AnimatedStarIcon as ChatWithAgentIcon };

type ChatWithAgentEntity =
  | { type: 'email'; id: string; name: string }
  | {
      type: 'document';
      id: string;
      name: string;
      fileType: string | null | undefined;
    }
  | { type: 'project'; id: string; name: string }
  | { type: 'channel'; id: string; name: string; channelType: ChannelType };

function buildSeed(entity: ChatWithAgentEntity): {
  mention: ChatAttachmentMention;
  attachment: Attachment;
} {
  const attachmentType: Attachment['entity_type'] =
    entity.type === 'email' ? 'email_thread' : entity.type;
  const blockName =
    entity.type === 'document'
      ? fileTypeToBlockName(entity.fileType, true)
      : entity.type === 'email'
        ? 'email'
        : entity.type;

  return {
    mention: {
      documentId: entity.id,
      documentName: entity.name,
      blockName,
      ...(entity.type === 'channel' ? { channelType: entity.channelType } : {}),
    },
    attachment: {
      entity_id: entity.id,
      entity_type: attachmentType,
    },
  };
}

async function createAndOpenChat(seed: {
  input?: string;
  attachments?: Attachment[];
  /** When set, sent immediately when the chat opens instead of seeding the input */
  message?: string;
  /** When set, replaces this split's content in place instead of opening a new split. */
  replaceSplit?: SplitHandle;
}) {
  const result = await createChat();
  if ('error' in result || !result.chatId) {
    console.warn('createAndOpenChat: createChat failed', result);
    toast.failure('Unable to start chat');
    return;
  }

  const { message, replaceSplit, ...stored } = seed;
  if (message) {
    setPendingSendData({
      content: message,
      attachments: seed.attachments ?? [],
      model: DEFAULT_MODEL,
    });
  } else {
    storeChatStateImmediate(result.chatId, stored);
  }
  if (replaceSplit) {
    replaceSplit.replace({ next: { type: 'chat', id: result.chatId } });
  } else {
    globalSplitManager()?.openWithSplit(
      { type: 'chat', id: result.chatId },
      { activate: true, preferNewSplit: true }
    );
  }
}

export async function openChatWithAgent(entity: ChatWithAgentEntity) {
  const { mention, attachment } = buildSeed(entity);
  const input = chatAttachmentMentionToMarkdown(mention);
  await createAndOpenChat({ input, attachments: [attachment] });
}

export async function openChatWithInput(initialInput: string) {
  await createAndOpenChat({ input: initialInput });
}

/**
 * Replace `splitHandle`'s content with a new chat seeded with `initialInput`
 * (not sent). Used by the search view's "Ask AI" button to hand off in place.
 */
export async function openChatWithInputReplacingSplit(
  initialInput: string,
  splitHandle: SplitHandle
) {
  await createAndOpenChat({ input: initialInput, replaceSplit: splitHandle });
}

/** Open a new chat and immediately send `message` (the chat picks it up via pending send) */
export async function openChatWithMessage(message: string) {
  await createAndOpenChat({ message });
}

/**
 * Replace `splitHandle`'s content with a new chat and immediately send
 * `message`. Used by the search view's "Ask AI" button to hand off in place.
 */
export async function openChatWithMessageReplacingSplit(
  message: string,
  splitHandle: SplitHandle
) {
  await createAndOpenChat({ message, replaceSplit: splitHandle });
}

export function ChatWithAgentButton(props: { entity: ChatWithAgentEntity }) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      tooltip="Chat with Agent"
      variant="outline"
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
      class="gap-1.5 rounded-full border border-edge-muted px-2"
    >
      <AnimatedStarIcon triggerAnimation={hovering()} />
      <span class="text-xs font-medium">Ask Macro</span>
    </Button>
  );
}
