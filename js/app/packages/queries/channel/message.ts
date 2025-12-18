import { TrackingEvents, withAnalytics } from '@coparse/analytics';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { invalidateChannelWithID } from '@queries/channel/channel';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import {
  commsServiceClient,
  type IdResponse,
  type MessageResponse,
} from '@service-comms/client';
import type { PostMessageRequest } from '@service-comms/generated/models';
import { useMutation } from '@tanstack/solid-query';

const { track } = withAnalytics();

type WithChannelID<T> = T & { channelID: string };

type SendMessageParams = WithChannelID<{ message: PostMessageRequest }>;

/**
 * Mutation to send an channel message.
 */
export function useSendMessageMutation(
  callbacks?: MutationCallbacks<IdResponse, Error, SendMessageParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: SendMessageParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.postMessage({
            channel_id: vars.channelID,
            message: vars.message,
          })
      );
    },
    ...withCallbacks<IdResponse, Error, SendMessageParams>(
      {
        onError(error) {
          console.error('failed to send message', error);
          toast.failure('Failed to send message');
        },
        onSuccess(_data, variables) {
          track(TrackingEvents.BLOCKCHANNEL.MESSAGE.SEND, {
            channelId: variables.channelID,
            contentLength: variables.message.content?.length ?? 0,
            attachmentsLength: variables.message.attachments.length,
            inThread: variables.message.thread_id !== undefined,
          });
        },
        onSettled: (_data, _error, variables) => {
          invalidateChannelWithID(variables.channelID);
        },
      },
      callbacks
    ),
  }));
}

type DeleteMessageParams = { channelID: string; messageID: string };

/**
 * Mutation to delete a channel message
 */
export function useDeleteMessageMutation(
  callbacks?: MutationCallbacks<void, Error, DeleteMessageParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: DeleteMessageParams) => {
      await throwOnErr(
        async () =>
          await commsServiceClient.deleteMessage({
            channel_id: vars.channelID,
            message_id: vars.messageID,
          })
      );
    },
    ...withCallbacks<void, Error, DeleteMessageParams>(
      {
        onError(error) {
          console.error('failed to delete message', error);
          toast.failure('Failed to delete message');
        },
        onSettled: (_data, _error, variables) => {
          invalidateChannelWithID(variables.channelID);
        },
      },
      callbacks
    ),
  }));
}

type PatchMessageParams = {
  channelID: string;
  messageID: string;
  content: string;
};

/**
 * Mutation to patch a channel message
 */
export function usePatchMessageMutation(
  callbacks?: MutationCallbacks<MessageResponse, Error, PatchMessageParams>
) {
  return useMutation(() => ({
    mutationFn: async (vars: PatchMessageParams) => {
      return await throwOnErr(
        async () =>
          await commsServiceClient.patchMessage({
            channel_id: vars.channelID,
            message_id: vars.messageID,
            content: vars.content,
          })
      );
    },
    ...withCallbacks<MessageResponse, Error, PatchMessageParams>(
      {
        onError(error) {
          console.error('failed to update message', error);
          toast.failure('Failed to update message');
        },
        onSettled: (_data, _error, variables) => {
          invalidateChannelWithID(variables.channelID);
        },
      },
      callbacks
    ),
  }));
}
