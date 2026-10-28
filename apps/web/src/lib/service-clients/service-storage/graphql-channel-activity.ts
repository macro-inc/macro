import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from './client';
import type { ActivityType } from './generated/schemas/activityType';
import type { ApiActivity } from './generated/schemas/apiActivity';
import {
  type ChannelActivityType,
  RecordChannelActivityDocument,
  type RecordChannelActivityMutationVariables,
} from './graphql/generated/graphql';
import { getGraphqlSoupClient } from './graphql-soup';

const ACTIVITY_TYPE_TO_GRAPHQL: Record<ActivityType, ChannelActivityType> = {
  view: 'VIEW',
  interact: 'INTERACT',
};

/** Record channel activity through the configured REST or GraphQL transport. */
export async function recordChannelActivity(args: {
  channelId: string;
  activityType: ActivityType;
}): Promise<ApiActivity> {
  if (!isFeatureEnabled(enableGraphqlSoup)) {
    return await throwOnErr(
      async () =>
        await storageServiceClient.postActivity({
          channel_id: args.channelId,
          activity_type: args.activityType,
        })
    );
  }

  const variables: RecordChannelActivityMutationVariables = {
    input: {
      channelId: args.channelId,
      activityType: ACTIVITY_TYPE_TO_GRAPHQL[args.activityType],
    },
  };
  const result = await getGraphqlSoupClient()
    .mutation(RecordChannelActivityDocument, variables)
    .toPromise();
  if (result.error) throw result.error;
  if (!result.data) {
    throw new Error('recordChannelActivity mutation returned no data');
  }

  const activity = result.data.recordChannelActivity;
  return {
    id: activity.id,
    user_id: activity.userId,
    channel_id: activity.channelId,
    created_at: activity.createdAt,
    updated_at: activity.updatedAt,
    viewed_at: activity.viewedAt ?? undefined,
    interacted_at: activity.interactedAt ?? undefined,
  };
}
