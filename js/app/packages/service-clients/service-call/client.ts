import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { mapOk } from '@core/util/maybeResult';
import type { CallActiveResponse } from '@service-storage/generated/schemas/callActiveResponse';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { CallTokenResponse } from '@service-storage/generated/schemas/callTokenResponse';
import type { LeaveCallResponse } from '@service-storage/generated/schemas/leaveCallResponse';
export type {
  CallActiveResponse,
  CallRecord,
  CallTokenResponse,
  LeaveCallResponse,
};

const host: string = SERVER_HOSTS['document-storage-service'];

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

  async checkActiveCall(channelId: string) {
    return mapOk(
      await fetchWithToken<CallActiveResponse>(
        `${host}/call/${channelId}/active`,
        { method: 'GET' }
      ),
      // safeFetch returns {} for 204 (no Content-Type header)
      (data) => ('callId' in data ? (data as CallActiveResponse) : null)
    );
  },

  async getCallRecord(callId: string) {
    return mapOk(
      await fetchWithToken<CallRecord>(`${host}/call/record/${callId}`, {
        method: 'GET',
      }),
      (result) => result
    );
  },
};
