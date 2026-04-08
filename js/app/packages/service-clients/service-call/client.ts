import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { mapOk } from '@core/util/maybeResult';
import type { CallTokenResponse } from '@service-storage/generated/schemas/callTokenResponse';
import type { LeaveCallResponse } from '@service-storage/generated/schemas/leaveCallResponse';
export type { CallTokenResponse, LeaveCallResponse };

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
};
