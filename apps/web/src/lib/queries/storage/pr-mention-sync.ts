import { queryClient } from '@queries/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { z } from 'zod';
import { pullRequestMentionKeys } from './keys';

// Paired with crates/github/src/outbound/connection_gateway_realtime.rs.
export const GITHUB_PULL_REQUEST_UPDATED = 'github_pull_request_updated';

const pullRequestEntitySchema = z.object({
  id: z.string().uuid(),
  foreignEntityId: z.string(),
  foreignEntitySource: z.literal('github_pull_request'),
  metadata: z.unknown(),
  storedForId: z.string(),
  storedForAuthEntity: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export async function handlePullRequestUpdated(
  payload: unknown
): Promise<void> {
  const parsed = pullRequestEntitySchema.safeParse(payload);
  if (!parsed.success) return;
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
