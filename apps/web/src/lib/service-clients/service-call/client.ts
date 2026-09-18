import { SERVER_HOSTS } from '@core/constant/servers';
import { fetchWithToken } from '@core/util/fetchWithToken';
import { safeFetch } from '@core/util/safeFetch';

import type { ActiveCallsResponse } from '@service-storage/generated/schemas/activeCallsResponse';
import type { CallActiveResponse } from '@service-storage/generated/schemas/callActiveResponse';
import type { CallRecord } from '@service-storage/generated/schemas/callRecord';
import type { CallTokenResponse as ApiCallTokenResponse } from '@service-storage/generated/schemas/callTokenResponse';
import type { CreateMeetingRequest } from '@service-storage/generated/schemas/createMeetingRequest';
import type { EditCallRecordRequest } from '@service-storage/generated/schemas/editCallRecordRequest';
import type { InviteMeetingRequest } from '@service-storage/generated/schemas/inviteMeetingRequest';
import type { LeaveCallResponse } from '@service-storage/generated/schemas/leaveCallResponse';
import type { Meeting as ApiMeeting } from '@service-storage/generated/schemas/meeting';
import type { UpdateMeetingRequest } from '@service-storage/generated/schemas/updateMeetingRequest';
import type { UpdateSharePermissionRequestV2 } from '@service-storage/generated/schemas/updateSharePermissionRequestV2';

export type { CallRecord, CreateMeetingRequest, UpdateMeetingRequest };

// Rust serializes these nullable fields explicitly; Orval marks Option<T> optional.
export type CallTokenResponse = Required<ApiCallTokenResponse>;
export type Meeting = Required<ApiMeeting>;

const host: string = SERVER_HOSTS['document-storage-service'];

export const callServiceClient = {
  inviteToMeeting(shareToken: string, email: string) {
    const body: InviteMeetingRequest = { email };
    return fetchWithToken<Record<string, never>>(
      `${host}/call/meetings/invite/${encodeURIComponent(shareToken)}`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  },
  createMeeting(body: CreateMeetingRequest) {
    return fetchWithToken<Meeting>(`${host}/call/meetings`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  updateMeeting(meetingId: string, body: UpdateMeetingRequest) {
    return fetchWithToken<Meeting>(
      `${host}/call/meetings/${encodeURIComponent(meetingId)}`,
      { method: 'PATCH', body: JSON.stringify(body) }
    );
  },

  async getMeetings() {
    return (
      await fetchWithToken<{ meetings: Meeting[] }>(`${host}/call/meetings`)
    ).map((result) => result.meetings);
  },

  cancelMeeting(meetingId: string) {
    return fetchWithToken<Record<string, never>>(
      `${host}/call/meetings/${encodeURIComponent(meetingId)}`,
      { method: 'DELETE' }
    );
  },

  getCallLink(callId: string) {
    return fetchWithToken<Meeting>(
      `${host}/call/record/${encodeURIComponent(callId)}/link`,
      { method: 'POST' }
    );
  },

  getMeeting(shareToken: string) {
    return safeFetch<Meeting>(
      `${host}/call/join/${encodeURIComponent(shareToken)}`,
      { credentials: 'omit' }
    );
  },

  joinMeeting(shareToken: string) {
    return fetchWithToken<CallTokenResponse>(
      `${host}/call/meetings/join/${encodeURIComponent(shareToken)}`,
      { method: 'POST' }
    );
  },

  joinMeetingAsGuest(shareToken: string, displayName: string) {
    return safeFetch<CallTokenResponse>(
      `${host}/call/join/${encodeURIComponent(shareToken)}`,
      {
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify({ displayName }),
      }
    );
  },

  leaveMeeting(shareToken: string, token: string) {
    return safeFetch<LeaveCallResponse>(
      `${host}/call/join/${encodeURIComponent(shareToken)}/leave`,
      {
        method: 'POST',
        credentials: 'omit',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
  },

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
