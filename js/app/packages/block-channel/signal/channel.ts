import type { ChannelData } from '@block-channel/definition';
import {
  type InputAttachment,
  isStaticAttachmentType,
} from '@core/store/cacheChannelInput';
import { getImageDimensions, getVideoDimensions } from '@core/util/media';
import { useSendMessageMutation } from '@queries/channel/message';
import { invalidateListChannels } from '@queries/channel/channels';
import type { NewAttachment } from '@service-comms/generated/models';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { useUserId } from '@core/context/user';
import { blockNameToItemType } from '@service-storage/client';
import type { Accessor } from 'solid-js';

export function isValidChannelData(
  data: ChannelData
): data is Required<ChannelData> {
  if (!data.channel) return false;
  if (!data.channel.id) return false;
  if (!data.participants) return false;
  return true;
}

export function doesChannelRequireJoin(
  data: Required<ChannelData>,
  userId: string
) {
  return (
    data.channel.channel_type === 'public' &&
    data.participants.find((p) => p.user_id === userId) === undefined
  );
}

function isMessageSendable(
  content: string | undefined,
  attachments: InputAttachment[]
): boolean {
  return (content && content.trim().length > 0) || attachments.length > 0;
}

export type SendMessageArgs = {
  content: string | undefined;
  attachments: InputAttachment[];
  threadId?: string;
  mentions?: SimpleMention[];
};

export function useSendChannelMessageAction(channelID: Accessor<string>) {
  const userId = useUserId();

  const mutation = useSendMessageMutation({
    onSettled() {
      invalidateListChannels();
    },
  });

  return async ({
    content,
    attachments,
    threadId,
    mentions,
  }: SendMessageArgs) => {
    if (!userId) return;
    if (!isMessageSendable(content, attachments)) return;

    const channelId = channelID();
    const senderId = userId()!;
    const optimisticId = crypto.randomUUID();

    const attachmentsToSend = await Promise.allSettled(
      attachments.map(async (a) => {
        const attachmentType = isStaticAttachmentType(a.blockName)
          ? a.blockName
          : blockNameToItemType(a.blockName);

        if (!attachmentType) return;

        let attachment: NewAttachment = {
          entity_id: a.id,
          entity_type: attachmentType,
        };

        if (!a.file) return attachment;

        if (
          attachmentType !== 'static/image' &&
          attachmentType !== 'static/video'
        ) {
          return attachment;
        }

        const dimensions =
          attachmentType === 'static/image'
            ? await getImageDimensions(a.file)
            : await getVideoDimensions(a.file);

        attachment.width = dimensions.width;
        attachment.height = dimensions.height;

        return attachment;
      })
    );

    const filteredAttachements = attachmentsToSend
      .map((r) => (r.status === 'fulfilled' ? r.value : undefined))
      .filter((r) => r !== undefined);

    await mutation.mutateAsync({
      channelID: channelId,
      optimisticId,
      senderId,
      message: {
        attachments: filteredAttachements,
        content: content ?? '',
        thread_id: threadId,
        mentions: mentions ?? [],
      },
    });
  };
}
