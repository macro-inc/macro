import type {
  ActiveCallSummary,
  ActiveCallsResponse,
  ActiveMeeting,
  ActiveMeetingsResponse,
  CallTokenResponse,
} from '../../../sdk/generated/storage/types.gen.ts';
import type { MacroHttp } from '../macro.ts';

export type Conn = {
  url: string;
  token: string;
  room: string;
  channel: string | null;
};
export type ActiveCall = Pick<
  ActiveCallSummary,
  'callId' | 'channelId' | 'createdBy'
>;
export type Meeting = Pick<
  ActiveMeeting,
  'id' | 'callId' | 'title' | 'shareToken' | 'createdBy' | 'channelId'
>;

export interface CallApi {
  join(
    kind: 'channel' | 'meeting',
    id: string,
    signal?: AbortSignal
  ): Promise<Conn>;
  activeCalls(): Promise<ActiveCall[]>;
  meetings(): Promise<Meeting[]>;
  channel(id: string): Promise<{ dm: boolean; name: string }>;
}

/** Wire types come from the generated storage contract. */
export function macroCalls(http: MacroHttp): CallApi {
  const json = async <T>(path: string, init?: RequestInit): Promise<T> =>
    (await http.send('call', `${http.hosts.storage}${path}`, init)).json();
  return {
    async join(kind, id, signal) {
      const path =
        kind === 'channel'
          ? `/call/${encodeURIComponent(id)}`
          : `/call/meetings/join/${encodeURIComponent(id)}`;
      const token = await json<CallTokenResponse>(path, {
        method: kind === 'channel' ? 'GET' : 'POST',
        signal,
      });
      return {
        url: token.serverUrl,
        token: token.token,
        room: token.roomName,
        channel: token.channelId ?? null,
      };
    },
    async activeCalls() {
      return (await json<ActiveCallsResponse>('/call/active')).calls;
    },
    async meetings() {
      return (await json<ActiveMeetingsResponse>('/call/meetings/active'))
        .meetings;
    },
    async channel(id) {
      const channel = await http.channel(id);
      return {
        dm: channel.channel_type === 'direct_message',
        name: channel.channel_name,
      };
    },
  };
}
