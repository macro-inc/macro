import { throwOnErr } from '@core/util/maybeResult';
import {
  callServiceClient,
  type TranscriptSegmentRequest,
} from '@service-call/client';
import { useMutation } from '@tanstack/solid-query';

export function useJoinCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(
        async () => await callServiceClient.getOrCreateCall(channelId)
      ),
    onError(error: Error) {
      console.error('failed to join call', error);
    },
  }));
}

export function useLeaveCallMutation() {
  return useMutation(() => ({
    gcTime: 0,
    mutationFn: async (channelId: string) =>
      await throwOnErr(
        async () => await callServiceClient.leaveCall(channelId)
      ),
    onError(error: Error) {
      console.error('failed to leave call', error);
    },
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
