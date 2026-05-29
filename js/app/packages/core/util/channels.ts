import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { toast } from '@core/component/Toast/Toast';
import { invalidateContacts } from '@core/user/contactService';

import { invalidateListChannels } from '@queries/channel/channels';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
import { storageServiceClient } from '@service-storage/client';
import type { NewChannelAttachment as NewAttachment } from '@service-storage/generated/schemas/newChannelAttachment';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import { createCallback } from '@solid-primitives/rootless';

type SendContent = {
  content: string;
  mentions: SimpleMention[];
  attachments?: NewAttachment[];
};

type NavigationOptions = {
  navigate: boolean;
  mergeHistory?: boolean;
};

type SendToUsersArgs = SendContent & {
  users: string[];
  navigate?: NavigationOptions;
};

type SendToChannelArgs = SendContent & {
  channelId: string;
  navigate?: NavigationOptions;
};

export function useSendMessageToPeople() {
  const { replaceSplit } = useSplitLayout();
  const orchestrator = useGlobalBlockOrchestrator();
  const getOrCreateDmMutation = useGetOrCreateDirectMessageMutation();
  const getOrCreatePrivateChannelMutation =
    useGetOrCreatePrivateChannelMutation();

  async function sendAndNavigateToChannel(
    channelId: string,
    content: string,
    mentions: SimpleMention[],
    attachments: NewAttachment[],
    navigate?: NavigationOptions
  ) {
    const message = await storageServiceClient.postMessage({
      channel_id: channelId,
      message: {
        content,
        attachments,
        mentions,
      },
    });

    if (message.isErr()) {
      toast.failure('Failed to send message to people');
      console.error('failed to post message to channel', message.error);
      return;
    }

    const messageResponse = message.value;

    invalidateListChannels();
    invalidateContacts();

    const navigateToChannel = async () => {
      replaceSplit({
        content: {
          type: 'channel',
          id: channelId,
        },
        mergeHistory: navigate?.mergeHistory,
      });
      const handle = await orchestrator.getBlockHandle(channelId);
      await handle?.goToLocationFromParams({
        [CHANNEL_PARAMS.message]: messageResponse.id,
      });
    };

    if (navigate?.navigate) {
      await navigateToChannel();
    }

    return { channelId, messageResponse, navigateToChannel };
  }

  async function sendToUsers(args: SendToUsersArgs) {
    let channelId: string;
    try {
      const result =
        args.users.length === 1
          ? await getOrCreateDmMutation.mutateAsync({
              recipient_id: args.users[0],
            })
          : await getOrCreatePrivateChannelMutation.mutateAsync({
              recipients: args.users,
            });
      channelId = result.channel_id;
    } catch (err) {
      toast.failure('Failed to send message to people');
      console.error('failed to create new channel to forward', err);
      return;
    }

    return sendAndNavigateToChannel(
      channelId,
      args.content,
      args.mentions,
      args.attachments ?? [],
      args.navigate
    );
  }

  async function sendToChannel(args: SendToChannelArgs) {
    return sendAndNavigateToChannel(
      args.channelId,
      args.content,
      args.mentions,
      args.attachments ?? [],
      args.navigate
    );
  }

  return {
    /** Sends a message to a list of users,
     * if the users already have an existing channel,
     * it will send the message to that channel
     * otherwise, it will create a new channel and send the message to that channel */
    sendToUsers: createCallback(sendToUsers),
    /** sends a message to an existing channel */
    sendToChannel: createCallback(sendToChannel),
  };
}
