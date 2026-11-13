import {
  currentQueryAccount,
  isCurrentQueryAccount,
} from '@queries/auth/account-scope';
import { queryClient } from '@queries/client';
import {
  getSoupEntityById,
  hydrateSoupEntity,
} from '@queries/soup/normalized-cache';
import type {
  ForeignEntity,
  StoredGithubPullRequest,
} from '@service-storage/generated/schemas';
import { getForeignEntityResponse } from '@service-storage/generated/zod';
import { hashKey } from '@tanstack/solid-query';
import { z } from 'zod';
import {
  prForeignEntityKeys,
  pullRequestMentionKeys,
  reviewsMergeabilityKeys,
} from './keys';

const pullRequestUpdatedSchema = getForeignEntityResponse.extend({
  metadata: z.record(z.string(), z.unknown()),
});
// The detail query keeps this identity beside its presentation fields.
type PrDetailCacheIdentity = {
  pullRequest: Pick<StoredGithubPullRequest, 'githubKey'>;
};

export async function handlePullRequestUpdated(
  payload: unknown
): Promise<void> {
  const parsed = pullRequestUpdatedSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.foreignEntitySource !== 'github_pull_request'
  ) {
    return;
  }
  const entity = parsed.data;
  const account = currentQueryAccount();
  if (!account) return;
  const keys = [
    pullRequestMentionKeys.foreignEntity(entity.id).queryKey,
    pullRequestMentionKeys.byGithubKey(entity.foreignEntityId).queryKey,
  ];
  const current = queryClient.getQueryData<ForeignEntity | null>(keys[1]);
  if (current && Date.parse(current.updatedAt) > Date.parse(entity.updatedAt))
    return;

  // GraphQL Soup owns list/card updates. REST lists use the pushed record below;
  // only separate detail and live-conflict queries need revalidation.
  const githubKey = entity.foreignEntityId.toLowerCase();
  const detailKeys = queryClient
    .getQueriesData<PrDetailCacheIdentity>({
      queryKey: prForeignEntityKeys._def,
    })
    .filter(
      ([key, data]) =>
        key.at(-1) === entity.id ||
        data?.pullRequest.githubKey.toLowerCase() === githubKey
    )
    .map(([key]) => key);
  const mergeabilityKey = githubKey.replace('/pull/', '#');
  const mergeabilityQueries = queryClient.getQueryCache().findAll({
    queryKey: reviewsMergeabilityKeys.mergeability._def,
    predicate: (query) => {
      const requests = query.queryKey[2];
      return Array.isArray(requests) && requests.includes(mergeabilityKey);
    },
  });
  const refreshedKeys = [
    ...detailKeys,
    ...mergeabilityQueries.map((query) => query.queryKey),
  ];

  // A lookup started before the webhook may still return null or stale data.
  // Cancel it before the pushed entity becomes the cache's current value.
  await Promise.all(
    [...keys, ...refreshedKeys].map((queryKey) =>
      queryClient.cancelQueries({ queryKey, exact: true })
    )
  );
  if (!isCurrentQueryAccount(account)) return;
  for (const queryKey of keys) {
    queryClient.setQueryData<ForeignEntity | null>(queryKey, (current) =>
      current && Date.parse(current.updatedAt) > Date.parse(entity.updatedAt)
        ? current
        : entity
    );
  }
  const cached = getSoupEntityById(entity.id);
  if (
    cached?.tag === 'foreignEntity' &&
    Date.parse(cached.data.updatedAt) <= Date.parse(entity.updatedAt)
  ) {
    hydrateSoupEntity({ ...cached, data: entity }, true);
  }
  const refreshedHashes = new Set(refreshedKeys.map(hashKey));
  queryClient.invalidateQueries({
    predicate: (query) => refreshedHashes.has(query.queryHash),
  });
}

export function invalidatePullRequestMentions(): void {
  queryClient.invalidateQueries({ queryKey: pullRequestMentionKeys._def });
}
