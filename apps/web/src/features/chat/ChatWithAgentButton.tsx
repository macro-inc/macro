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
import AgentIcon from '@phosphor/sparkle.svg';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { Button } from '@ui';
import { createSignal } from 'solid-js';

export { AgentIcon as ChatWithAgentIcon };

type ChatWithAgentEntity =
  | { type: 'email'; id: string; name: string }
  | {
      type: 'document';
      id: string;
      name: string;
      fileType: string | null | undefined;
      blockParams?: Record<string, string>;
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
      ...(entity.type === 'document' && entity.blockParams
        ? { blockParams: entity.blockParams }
        : {}),
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
  const manager = globalSplitManager();
  if (!seed.replaceSplit && !manager) {
    toast.failure('Unable to open chat');
    return false;
  }
  let result: Awaited<ReturnType<typeof createChat>>;
  try {
    result = await createChat();
  } catch {
    toast.failure('Unable to start chat');
    return false;
  }
  if ('error' in result || !result.chatId) {
    console.warn('createAndOpenChat: createChat failed', result);
    toast.failure('Unable to start chat');
    return false;
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
    manager?.openWithSplit(
      { type: 'chat', id: result.chatId },
      { activate: true, preferNewSplit: true }
    );
  }
  return true;
}

export async function openChatWithAgent(entity: ChatWithAgentEntity) {
  const { mention, attachment } = buildSeed(entity);
  const input = `${chatAttachmentMentionToMarkdown(mention)} `;
  return createAndOpenChat({ input, attachments: [attachment] });
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

export function ChatWithAgentButton(props: {
  entity: ChatWithAgentEntity;
  /** Button text; defaults to "Chat". */
  label?: string;
  disabled?: boolean;
}) {
  const [opening, setOpening] = createSignal(false);
  async function open() {
    if (opening() || props.disabled) return;
    setOpening(true);
    try {
      await openChatWithAgent(props.entity);
    } finally {
      setOpening(false);
    }
  }
  return (
    <Button
      tooltip={props.label ?? 'Chat with Agent'}
      variant="outline"
      size="sm"
      onClick={() => void open()}
      disabled={props.disabled || opening()}
      aria-busy={opening()}
      depth={2}
      class="bg-surface"
    >
      <AgentIcon />
      <span class="text-xs">{props.label ?? 'Chat'}</span>
    </Button>
  );
}

export function AskMacroButton(props: { entity: ChatWithAgentEntity }) {
  return (
    <Button
      onClick={() => openChatWithAgent(props.entity)}
      variant="ghost"
      size="sm"
      depth={2}
      class="gap-1.5 rounded-full border border-edge-muted px-2"
    >
      <AgentIcon />
      <span class="text-xs font-medium">Ask Macro</span>
    </Button>
  );
}
