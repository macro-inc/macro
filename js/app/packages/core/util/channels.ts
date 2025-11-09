import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { withAnalytics } from '@coparse/analytics';
import { TrackingEvents } from '@coparse/analytics/src/types/TrackingEvents';
import { useChannelsContext } from '@core/component/ChannelsProvider';
import { toast } from '@core/component/Toast/Toast';
import { refetchContacts } from '@core/user/contactService';
import { isErr } from '@core/util/maybeResult';
import { commsServiceClient, type IdResponse } from '@service-comms/client';
import type {
  NewAttachment,
  SimpleMention,
} from '@service-comms/generated/models';
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

export type SendToUsersArgs = SendContent & {
  users: string[];
  navigate?: NavigationOptions;
};

export type SendToChannelArgs = SendContent & {
  channelId: string;
  navigate?: NavigationOptions;
};

export function useSendMessageToPeople() {
  const { track } = withAnalytics();
  const channelsContext = useChannelsContext();
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

    channelsContext.refetchChannels();
    refetchContacts();

    const navigateToChannel = async () => {
      replaceSplit(
        {
          type: 'channel',
          id: channelId,
        },
        navigate?.mergeHistory
      );
      const handle = await orchestrator.getBlockHandle(channelId);
      await handle?.goToLocationFromParams({
        message_id: messageResponse.id,
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

    if (result?.at(1)?.action === 'create') {
      track(TrackingEvents.BLOCKCHANNEL.CHANNEL.CREATE);
    }

    track(TrackingEvents.BLOCKCHANNEL.MESSAGE.SEND, {
      fromNewMessageModal: true,
    });
    return sendAndNavigateToChannel(
      result[1].channel_id,
      args.content,
      args.mentions,
      args.attachments ?? [],
      args.navigate
    );
  }

  async function sendToChannel(args: SendToChannelArgs) {
    track(TrackingEvents.BLOCKCHANNEL.MESSAGE.SEND, {
      fromNewMessageModal: true,
    });
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
