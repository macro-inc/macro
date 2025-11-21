import { isErr } from '@core/util/maybeResult';
import { queryKeys } from '@macro-entity';
import { commsServiceClient } from '@service-comms/client';
import type {
  ActivityType,
  ChannelWithLatest,
} from '@service-comms/generated/models';
import type { Activity as ChannelActivity } from '@service-comms/generated/models/activity';
import { type UseQueryResult, useQuery } from '@tanstack/solid-query';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  type ParentProps,
  useContext,
} from 'solid-js';

const ACTIVITY_QUERY_KEY = ['channelActivity'];

export function createChannelActivityQuery() {
  return useQuery(() => ({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: async () => {
      const result = await commsServiceClient.getActivity();

      if (isErr(result)) {
        throw new Error('Failed to fetch activity', { cause: result[0] });
      }

      return result[1]?.items ?? [];
    },
  }));
}

export function createChannelsQuery() {
  return useQuery(() => ({
    queryKey: queryKeys.all.channel,
    queryFn: async () => {
      const result = await commsServiceClient.getChannels();

      if (isErr(result)) {
        throw new Error('Failed to fetch channels', { cause: result[0] });
      }

      return result[1]?.channels ?? [];
    },
  }));
}

export type ChannelsContext = {
  readonly channels: Accessor<ChannelWithLatest[]>;
  readonly activity: Accessor<ChannelActivity[]>;
  readonly isLoading: Accessor<boolean>;

  readonly _channelsQuery: UseQueryResult<ChannelWithLatest[], Error>;
  readonly _activityQuery: UseQueryResult<ChannelActivity[], Error>;

  /** Post a new activity for a channel */
  updateActivityForChannel(
    channelId: string,
    activityType: ActivityType
  ): Promise<void>;

  // NOTE: Ideally nothing should require a manual refetch
  // Once we hook all the tanstack queries togehter, we can remove these refetch calls

  refetchChannels(): Promise<void>;
  refetchActivity(): Promise<void>;
};

function createChannelsContext(
  channelsQuery: UseQueryResult<ChannelWithLatest[], Error>,
  activityQuery: UseQueryResult<ChannelActivity[], Error>
): ChannelsContext {
  const [channels, setChannels] = createSignal<ChannelWithLatest[]>([]);
  const [activity, setActivity] = createSignal<ChannelActivity[]>([]);

  createEffect(() => {
    if (!channelsQuery.isSuccess) return;
    setChannels(channelsQuery.data ?? []);
  });

  createEffect(() => {
    if (!activityQuery.isSuccess) return;
    setActivity(activityQuery.data ?? []);
  });

  const updateActivityForChannel = async (
    channelId: string,
    activityType: ActivityType
  ) => {
    await commsServiceClient.postActivity({
      activity_type: activityType,
      channel_id: channelId,
    });
    activityQuery.refetch();
  };

  const refetchChannels = async () => {
    await channelsQuery.refetch();
  };

  const refetchActivity = async () => {
    await activityQuery.refetch();
  };

  return {
    channels,
    activity,
    isLoading: () => channelsQuery.isLoading || activityQuery.isLoading,
    _channelsQuery: channelsQuery,
    _activityQuery: activityQuery,
    updateActivityForChannel,
    refetchChannels,
    refetchActivity,
  };
}

const ChannelsContext = createContext<ChannelsContext>();

export function ChannelsContextProvider(
  props: ParentProps & {
    channelsQuery?: ReturnType<typeof createChannelsQuery>;
    activityQuery?: ReturnType<typeof createChannelActivityQuery>;
  }
) {
  const channelsContext = createChannelsContext(
    props.channelsQuery ?? createChannelsQuery(),
    props.activityQuery ?? createChannelActivityQuery()
  );

  return (
    <ChannelsContext.Provider value={channelsContext}>
      {props.children}
    </ChannelsContext.Provider>
  );
}

const CHANNEL_CONTEXT_ERROR = `ChannelsContext not found. Make sure you are calling it under <ChannelsContextProvider />`;

export function useChannelsContext() {
  const context = useContext(ChannelsContext);
  if (!context) {
    throw new Error(CHANNEL_CONTEXT_ERROR);
  }
  return context;
}

export function useLatestActivityForChannel(channelId: string) {
  const context = useChannelsContext();
  return createMemo(() =>
    context.activity().find((a) => a.channel_id === channelId)
  );
}

export function useChannelName(channelId: string, fallback?: string) {
  const context = useChannelsContext();
  return createMemo(() => {
    const channel = context.channels().find((c) => c.id === channelId);
    return channel?.name ?? fallback;
  });
}
