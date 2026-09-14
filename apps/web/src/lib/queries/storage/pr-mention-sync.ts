import { queryClient } from '@queries/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { getForeignEntityResponse } from '@service-storage/generated/zod';
import { pullRequestMentionKeys } from './keys';

export async function handlePullRequestUpdated(
  payload: unknown
): Promise<void> {
  const parsed = getForeignEntityResponse.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.foreignEntitySource !== 'github_pull_request'
  ) {
    return;
  }
  const entity: ForeignEntity = parsed.data;
  const keys = [
    pullRequestMentionKeys.foreignEntity(entity.id).queryKey,
    pullRequestMentionKeys.byGithubKey(entity.foreignEntityId).queryKey,
  ];

  // A lookup started before the webhook may still return null or stale data.
  // Cancel it before the pushed entity becomes the cache's current value.
  await Promise.all(
    keys.map((queryKey) => queryClient.cancelQueries({ queryKey, exact: true }))
  );
  for (const queryKey of keys) {
    queryClient.setQueryData<ForeignEntity | null>(queryKey, (current) =>
      current && Date.parse(current.updatedAt) > Date.parse(entity.updatedAt)
        ? current
        : entity
    );
  }
}

export function invalidatePullRequestMentions(): void {
  void queryClient.invalidateQueries({ queryKey: pullRequestMentionKeys._def });
}
