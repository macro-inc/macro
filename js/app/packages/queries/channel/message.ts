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
import type {
  GetChannelResponse,
  PostMessageRequest,
} from '@service-comms/generated/models';
import { useMutation } from '@tanstack/solid-query';
import { queryClient } from '../client';
import { channelKeys } from './keys';
import {
  optimisticDeleteChannelMessage,
  optimisticInsertChannelMessage,
  optimisticUpdateChannelMessage,
  replaceOptimisticMessage,
} from './optimistic';

const { track } = withAnalytics();

type WithChannelID<T> = T & { channelID: string };

type MessageMutationContext = { previous: GetChannelResponse | undefined };

type SendMessageParams = WithChannelID<{
  message: PostMessageRequest;
  optimisticId: string;
  senderId: string;
}>;

/**
 * Mutation to send an channel message.
 */
export function useSendMessageMutation(
  callbacks?: MutationCallbacks<
    IdResponse,
    Error,
    SendMessageParams,
    MessageMutationContext
  >
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
    ...withCallbacks<
      IdResponse,
      Error,
      SendMessageParams,
      MessageMutationContext
    >(
      {
        onMutate: (vars) => {
          const previous = optimisticInsertChannelMessage({
            channelId: vars.channelID,
            optimisticId: vars.optimisticId,
            senderId: vars.senderId,
            ...vars.message,
          });
          return { previous };
        },
        onSuccess(data, variables) {
          replaceOptimisticMessage({
            channelId: variables.channelID,
            optimisticId: variables.optimisticId,
            realId: data.id,
          });
          track(TrackingEvents.BLOCKCHANNEL.MESSAGE.SEND, {
            channelId: variables.channelID,
            contentLength: variables.message.content?.length ?? 0,
            attachmentsLength: variables.message.attachments.length,
            inThread: variables.message.thread_id !== undefined,
          });
        },
        onError(error, vars, context) {
          console.error('failed to send message', error);
          toast.failure('Failed to send message');
          if (context?.previous) {
            queryClient.setQueryData(
              channelKeys.withID(vars.channelID).queryKey,
              context.previous
            );
          }
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
  callbacks?: MutationCallbacks<
    void,
    Error,
    DeleteMessageParams,
    MessageMutationContext
  >
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
    ...withCallbacks<void, Error, DeleteMessageParams, MessageMutationContext>(
      {
        onMutate: (vars) => {
          const previous = optimisticDeleteChannelMessage({
            channelId: vars.channelID,
            message_id: vars.messageID,
          });
          return { previous };
        },
        onError(error, vars, context) {
          console.error('failed to delete message', error);
          toast.failure('Failed to delete message');
          if (context?.previous) {
            queryClient.setQueryData(
              channelKeys.withID(vars.channelID).queryKey,
              context.previous
            );
          }
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
  callbacks?: MutationCallbacks<
    MessageResponse,
    Error,
    PatchMessageParams,
    MessageMutationContext
  >
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
    ...withCallbacks<
      MessageResponse,
      Error,
      PatchMessageParams,
      MessageMutationContext
    >(
      {
        onMutate: (vars) => {
          const previous = optimisticUpdateChannelMessage({
            channelId: vars.channelID,
            message_id: vars.messageID,
            content: vars.content,
          });
          return { previous };
        },
        onError(error, vars, context) {
          console.error('failed to update message', error);
          toast.failure('Failed to update message');
          if (context?.previous) {
            queryClient.setQueryData(
              channelKeys.withID(vars.channelID).queryKey,
              context.previous
            );
          }
        },
        onSettled: (_data, _error, variables) => {
          invalidateChannelWithID(variables.channelID);
        },
      },
      callbacks
    ),
  }));
}
