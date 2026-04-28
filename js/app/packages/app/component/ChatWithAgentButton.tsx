import { globalSplitManager } from '@app/signal/splitLayout';
import { toast } from '@core/component/Toast/Toast';
import { Tooltip } from '@core/component/Tooltip';
import type { Attachment } from '@core/component/AI/types';
import { asFileType } from '@core/component/AI/util';
import { storeChatStateImmediate } from '@core/component/AI/util/storage';
import { createChat } from '@core/util/create';
import { AnimatedStarIcon } from '@macro-icons/wide/animating/star';
import { ChannelType } from '@service-cognition/generated/schemas/channelType';
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
      id: `${e.id}-email-attachment`,
      attachmentId: e.id,
      attachmentType: 'email' as const,
      metadata: {
        type: 'email' as const,
        email_subject: e.name || 'No Subject',
      },
    }))
    .with({ type: 'document' }, (e) => {
      const fileType = asFileType(e.fileType);
      if (!fileType) return undefined;
      return {
        id: `${e.id}-document-attachment`,
        attachmentId: e.id,
        attachmentType: 'document' as const,
        metadata: {
          type: 'document' as const,
          document_type: fileType,
          document_name: e.name,
        },
      };
    })
    .with({ type: 'project' }, (e) => ({
      id: `${e.id}-project-attachment`,
      attachmentId: e.id,
      attachmentType: 'project' as const,
      metadata: { type: 'project' as const, project_name: e.name },
    }))
    .with({ type: 'channel' }, (e) => ({
      id: `${e.id}-channel-attachment`,
      attachmentId: e.id,
      attachmentType: 'channel' as const,
      metadata: {
        type: 'channel' as const,
        channel_type: e.channelType,
        channel_name: e.name,
      },
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
    <Tooltip tooltip="Chat with Agent">
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
    </Tooltip>
  );
}
