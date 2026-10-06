import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { invalidateContacts } from '@core/user/contactService';
import { invalidateListChannels } from '@queries/channel/channels';
import {
  useGetOrCreateDirectMessageMutation,
  useGetOrCreatePrivateChannelMutation,
} from '@queries/channel/get-or-create-dm';
import {
  newMessageId,
  useSendMessageMutation,
} from '@queries/messages/mutations';
import type { NewAttachment } from '@service-storage/generated/schemas/newAttachment';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import { createCallback } from '@solid-primitives/rootless';

type SendContent = {
  content: string;
  mentions: SimpleMention[];
  attachments?: NewAttachment[];
  /** Reuse one id across retries of the same message, so the server stores one copy. */
  messageId?: string;
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
  const userId = useUserId();
  const sendMessage = useSendMessageMutation();

  async function sendAndNavigateToChannel(
    channelId: string,
    args: SendContent & { navigate?: NavigationOptions }
  ) {
    const senderId = userId();
    if (!senderId) return;
    const sent = await sendMessage
      .mutateAsync({
        parent: { type: 'channel', id: channelId },
        message: {
          content: args.content,
          attachments: args.attachments ?? [],
          mentions: args.mentions,
        },
        senderId,
        optimisticId: args.messageId ?? newMessageId(),
      })
      .catch(() => undefined);
    if (!sent) return;
    const messageId = sent.id;

    invalidateListChannels();
    invalidateContacts();

    const navigateToChannel = async () => {
      replaceSplit({
        content: {
          type: 'channel',
          id: channelId,
        },
        mergeHistory: args.navigate?.mergeHistory,
      });
      const handle = await orchestrator.getBlockHandle(channelId);
      await handle?.goToLocationFromParams({
        [CHANNEL_PARAMS.message]: messageId,
      });
    };

    if (args.navigate?.navigate) {
      await navigateToChannel();
    }

    return { channelId, messageId, navigateToChannel };
  }

  async function resolvePeopleChannel(
    users: readonly string[]
  ): Promise<string | undefined> {
    try {
      const result =
        users.length === 1
          ? await getOrCreateDmMutation.mutateAsync({
              recipient_id: users[0],
            })
          : await getOrCreatePrivateChannelMutation.mutateAsync({
              recipients: [...users],
            });
      return result.channel_id;
    } catch (err) {
      toast.failure('Failed to send message to people');
      console.error('failed to create new channel to forward', err);
      return undefined;
    }
  }

  async function sendToUsers(args: SendToUsersArgs) {
    const channelId = await resolvePeopleChannel(args.users);
    if (channelId === undefined) return;
    return sendAndNavigateToChannel(channelId, args);
  }

  async function sendToChannel(args: SendToChannelArgs) {
    return sendAndNavigateToChannel(args.channelId, args);
  }

  return {
    /** Finds or creates the DM for one user or the private channel for several. */
    resolvePeopleChannel: createCallback(resolvePeopleChannel),
    /** Sends a message to a list of users,
     * if the users already have an existing channel,
     * it will send the message to that channel
     * otherwise, it will create a new channel and send the message to that channel */
    sendToUsers: createCallback(sendToUsers),
    /** sends a message to an existing channel */
    sendToChannel: createCallback(sendToChannel),
  };
}
