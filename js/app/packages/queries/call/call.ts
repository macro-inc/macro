import { throwOnErr } from '@core/util/maybeResult';
import {
  callServiceClient,
  type CallTokenResponse,
  type LeaveCallResponse,
  type TranscriptSegmentRequest,
} from '@service-call/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { useMutation } from '@tanstack/solid-query';

export function useJoinCallMutation(
  callbacks?: MutationCallbacks<CallTokenResponse, Error, string>
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(
        async () => await callServiceClient.getOrCreateCall(channelId)
      ),
    ...withCallbacks(
      {
        onError(error) {
          console.error('failed to join call', error);
        },
      },
      callbacks
    ),
  }));
}

export function useLeaveCallMutation(
  callbacks?: MutationCallbacks<LeaveCallResponse, Error, string>
) {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(
        async () => await callServiceClient.leaveCall(channelId)
      ),
    ...withCallbacks(
      {
        onError(error) {
          console.error('failed to leave call', error);
        },
      },
      callbacks
    ),
  }));
}

type SendTranscriptVars = {
  channelId: string;
  segment: TranscriptSegmentRequest;
};

export function useSendTranscriptMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (vars: SendTranscriptVars) => {
      await callServiceClient.sendTranscriptSegment(
        vars.channelId,
        vars.segment
      );
    },
  }));
}
