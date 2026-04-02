import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { invalidateListChannels } from '@queries/channel/channels';
import { toast } from '@core/component/Toast/Toast';
import { invalidateContacts } from '@core/user/contactService';
import { isErr } from '@core/util/maybeResult';
import { commsServiceClient, type IdResponse } from '@service-comms/client';
import type {
  NewAttachment,
  SimpleMention,
} from '@service-comms/generated/models';
import { createCallback } from '@solid-primitives/rootless';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';

type SendContent = {
  content: string;
  mentions: SimpleMention[];
  attachments?: NewAttachment[];
};

type NavigationOptions = {
  navigate: boolean;
  mergeHistory?: boolean;
};

export type SendToUsersArgs = SendContent & {
  users: string[];
  navigate?: NavigationOptions;
};

export type SendToChannelArgs = SendContent & {
  channelId: string;
  navigate?: NavigationOptions;
};

export function useSendMessageToPeople() {
  const { replaceSplit } = useSplitLayout();
  const orchestrator = useGlobalBlockOrchestrator();

  async function sendAndNavigateToChannel(
    channelId: string,
    content: string,
    mentions: SimpleMention[],
    attachments: NewAttachment[],
    navigate?: NavigationOptions
  ) {
    const message = await commsServiceClient.postMessage({
      channel_id: channelId,
      message: {
        content,
        attachments,
        mentions,
      },
    });

    if (isErr(message) || !message.at(1)) {
      toast.failure('Failed to send message to people');
      console.error('failed to post message to channel', message);
      return;
    }

    const messageResponse = message.at(1) as IdResponse;

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
    const result =
      args.users.length === 1
        ? await commsServiceClient.getOrCreateDirectMessage({
            recipient_id: args.users[0],
          })
        : await commsServiceClient.getOrCreatePrivateChannel({
            recipients: args.users,
          });

    if (isErr(result)) {
      toast.failure('Failed to send message to people');
      console.error('failed to create new channel to forward', result);
      return;
    }

    return sendAndNavigateToChannel(
      result[1].channel_id,
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
