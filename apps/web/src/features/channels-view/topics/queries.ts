import { throwOnErr } from '@core/util/result';
import { invalidateListChannels } from '@queries/channel/channels';
import { queryClient } from '@queries/client';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

export type ChannelTopic = {
  id: string;
  team_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  sort_position: number | null;
  channel_count: number;
  channel_ids: string[];
};

export const topicQueryKey = ['channel-topics'] as const;

export function useChannelTopicsQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: topicQueryKey,
    queryFn: async () =>
      (await throwOnErr(() => storageServiceClient.listChannelTopics())).topics,
    enabled: enabled(),
    staleTime: 30_000,
  }));
}

export function refreshChannelTopics() {
  return queryClient.invalidateQueries({ queryKey: topicQueryKey });
}

export async function createTopic(name: string, description?: string) {
  const { id } = await throwOnErr(() =>
    storageServiceClient.createChannelTopic({ name, description })
  );
  await refreshChannelTopics();
  return id;
}

export async function updateTopic(id: string, name: string) {
  await throwOnErr(() => storageServiceClient.updateChannelTopic(id, { name }));
  await refreshChannelTopics();
}

export async function deleteTopic(id: string) {
  await throwOnErr(() => storageServiceClient.deleteChannelTopic(id));
  await refreshChannelTopics();
}

export async function addChannelToTopic(topicId: string, channelId: string) {
  await throwOnErr(() =>
    storageServiceClient.addChannelToTopic(topicId, channelId)
  );
  await refreshChannelTopics();
}

export async function removeChannelFromTopic(
  topicId: string,
  channelId: string
) {
  await throwOnErr(() =>
    storageServiceClient.removeChannelFromTopic(topicId, channelId)
  );
  await refreshChannelTopics();
}

export async function setTopicOrder(ids: string[]) {
  await throwOnErr(() => storageServiceClient.setChannelTopicOrder(ids));
  await refreshChannelTopics();
}

export async function leaveTopicRailChannel(channelId: string) {
  await throwOnErr(() =>
    storageServiceClient.leaveChannel({ channel_id: channelId })
  );
  await invalidateListChannels();
  await refreshChannelTopics();
}
