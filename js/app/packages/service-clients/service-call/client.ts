import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { mapOk } from '@core/util/maybeResult';

const host: string = SERVER_HOSTS['document-storage-service'];

export type CallTokenResponse = {
  callId: string;
  channelId: string;
  token: string;
  roomName: string;
  serverUrl: string;
};

export type LeaveCallResponse = {
  callEnded: boolean;
};

export type TranscriptSegmentPayload = {
  segmentId: string;
  speakerId: string;
  content: string;
  startedAt: string;
  endedAt: string | null;
  isFinal: boolean;
};

export const callServiceClient = {
  async getOrCreateCall(channelId: string) {
    return mapOk(
      await fetchWithToken<CallTokenResponse>(`${host}/call/${channelId}`, {
        method: 'GET',
      }),
      (result) => result
    );
  },

  async leaveCall(channelId: string) {
    return mapOk(
      await fetchWithToken<LeaveCallResponse>(`${host}/call/${channelId}`, {
        method: 'DELETE',
      }),
      (result) => result
    );
  },

  async sendTranscriptSegment(
    channelId: string,
    segment: TranscriptSegmentPayload
  ) {
    return fetchWithToken(`${host}/call/${channelId}/transcript`, {
      method: 'POST',
      body: JSON.stringify(segment),
    });
  },
};
