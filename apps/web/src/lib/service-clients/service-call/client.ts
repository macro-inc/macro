import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';

import type { ActiveCallsResponse } from '@service-storage/generated/schemas/activeCallsResponse';
import type { CallActiveResponse } from '@service-storage/generated/schemas/callActiveResponse';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { CallTokenResponse } from '@service-storage/generated/schemas/callTokenResponse';
import type { EditCallRecordRequest } from '@service-storage/generated/schemas/editCallRecordRequest';
import type { LeaveCallResponse } from '@service-storage/generated/schemas/leaveCallResponse';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';

export type { CallRecord, CallTokenResponse };

const host: string = SERVER_HOSTS['document-storage-service'];

export const callServiceClient = {
  async getOrCreateCall(channelId: string) {
    return (
      await fetchWithToken<CallTokenResponse>(`${host}/call/${channelId}`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async leaveCall(channelId: string) {
    return (
      await fetchWithToken<LeaveCallResponse>(`${host}/call/${channelId}`, {
        method: 'DELETE',
      })
    ).map((result) => result);
  },

  async checkActiveCall(channelId: string) {
    return (
      await fetchWithToken<CallActiveResponse>(
        `${host}/call/${channelId}/active`,
        { method: 'GET' }
      )
    ).map(
      // safeFetch returns {} for 204 (no Content-Type header)
      (data) => ('callId' in data ? (data as CallActiveResponse) : null)
    );
  },

  async getActiveCalls() {
    return (
      await fetchWithToken<ActiveCallsResponse>(`${host}/call/active`, {
        method: 'GET',
      })
    ).map((response) => response.calls ?? []);
  },

  async getCallRecord(callId: string) {
    return (
      await fetchWithToken<CallRecord>(`${host}/call/record/${callId}`, {
        method: 'GET',
      })
    ).map((result) => result);
  },

  async deleteCallRecord(callId: string) {
    return (
      await fetchWithToken<Record<string, never>>(
        `${host}/call/record/${callId}`,
        { method: 'DELETE' }
      )
    ).map(() => undefined);
  },

  /**
   * `POST /call/record/{id}/share-with-team/toggle`: flips the live call's
   * share-with-team toggle and returns the new value. The toggle becomes
   * canonical team sharing (view for the creator's team) when the call is
   * archived; archived calls answer 409 and are edited via `editCallRecord`.
   */
  async toggleShareWithTeam(callId: string) {
    // fetchWithToken requires T extends ObjectLike, but this endpoint returns a
    // primitive JSON boolean. response.json() parses it correctly at runtime;
    // we only need to satisfy the generic constraint.
    const result = await fetchWithToken<Record<string, never>>(
      `${host}/call/record/${callId}/share-with-team/toggle`,
      { method: 'POST' }
    );
    return result.map((r) => r as unknown as boolean);
  },

  /**
   * `PATCH /call/record/{id}`. Team sharing goes through
   * `sharePermission.teamShareAccessLevel`, capped at `'view'` (`null`
   * revokes). While the call is live it sets the pending toggle; once the
   * call is archived the backend authorizes it against the call's creator.
   */
  async editCallRecord(params: {
    callId: string;
    customName?: string;
    sharePermission?: UpdateSharePermissionRequestV2;
  }) {
    const body: EditCallRecordRequest = {};
    if (params.customName !== undefined) body.customName = params.customName;
    if (params.sharePermission !== undefined)
      body.sharePermission = params.sharePermission;

    return (
      await fetchWithToken<Record<string, never>>(
        `${host}/call/record/${params.callId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        }
      )
    ).map(() => undefined);
  },
};
