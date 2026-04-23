import { globalSplitManager } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import type { Attachment } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import { storeChatStateImmediate } from '@core/component/AI/util/storage';
import { createChat } from '@core/util/create';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { ChannelType } from '@service-cognition/generated/schemas/channelType';
import { createSignal } from 'solid-js';

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
  switch (entity.type) {
    case 'email':
      return {
        id: `${entity.id}-email-attachment`,
        attachmentId: entity.id,
        attachmentType: 'email',
        metadata: {
          type: 'email',
          email_subject: entity.name || 'No Subject',
        },
      };
    case 'document': {
      const fileType = asFileType(entity.fileType);
      if (!fileType) return undefined;
      return {
        id: `${entity.id}-document-attachment`,
        attachmentId: entity.id,
        attachmentType: 'document',
        metadata: {
          type: 'document',
          document_type: fileType,
          document_name: entity.name,
        },
      };
    }
    case 'project':
      return {
        id: `${entity.id}-project-attachment`,
        attachmentId: entity.id,
        attachmentType: 'project',
        metadata: { type: 'project', project_name: entity.name },
      };
    case 'channel':
      return {
        id: `${entity.id}-channel-attachment`,
        attachmentId: entity.id,
        attachmentType: 'channel',
        metadata: {
          type: 'channel',
          channel_type: entity.channelType,
          channel_name: entity.name,
        },
      };
  }
}

export async function openChatWithAgent(entity: ChatWithAgentEntity) {
  const attachment = buildAttachment(entity);
  if (!attachment) {
    console.warn('openChatWithAgent: unable to build attachment', entity);
    toast.failure("Can't attach this item to a chat");
    return;
  }

  const result = await createChat();
  if ('error' in result || !result.chatId) {
    console.warn('openChatWithAgent: createChat failed', result);
    toast.failure('Unable to start chat');
    return;
  }

  storeChatStateImmediate(result.chatId, { attachments: [attachment] });
  globalSplitManager()?.openWithSplit(
    { type: 'chat', id: result.chatId },
    { activate: true, preferNewSplit: true }
  );
}

export function ChatWithAgentButton(props: { entity: ChatWithAgentEntity }) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <div class="border-1 border-edge-muted flex ml-1 items-stretch rounded-xs">
      <button
        class="h-7 px-2 flex items-center gap-1 text-xs hover:bg-hover hover-transition-bg"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onClick={() => openChatWithAgent(props.entity)}
      >
        <div class="size-4">
          <AnimatedStarIcon triggerAnimation={hovering()} />
        </div>
        <span class="text-ink">Chat</span>
      </button>
    </div>
  );
}
