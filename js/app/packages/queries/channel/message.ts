import { TrackingEvents, withAnalytics } from '@coparse/analytics';
import { toast } from '@core/component/Toast/Toast';
import { throwOnErr } from '@core/util/maybeResult';
import { invalidateChannelWithID } from '@queries/channel/channel';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { commsServiceClient, type IdResponse } from '@service-comms/client';
import type { PostMessageRequest } from '@service-comms/generated/models';
import { useMutation } from '@tanstack/solid-query';

const { track } = withAnalytics();

type WithChannelID<T> = T & { channelID: string };

type SendMessageParams = WithChannelID<{ message: PostMessageRequest }>;

/**
 * Mutation to send an email message.
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
