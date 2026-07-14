import type { IUser } from '@core/user/types';
import { channelParticipantInfo } from '@core/user/util';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { type Accessor, createMemo } from 'solid-js';

export type ChannelParticipantsData = {
  users: Accessor<IUser[]>;
  ids: Accessor<string[]>;
};
export function useChannelParticipants(
  channelId: Accessor<string>
): ChannelParticipantsData {
  const query = useChannelParticipantsQuery(channelId);

  const users = createMemo(() => {
    if (query.isLoading) return [];
    return (query.data ?? []).map(channelParticipantInfo);
  });

  const ids = createMemo(() => {
    if (query.isLoading) return [];
    return (query.data ?? []).map((p) => p.user_id);
  });

  return { users, ids };
}
