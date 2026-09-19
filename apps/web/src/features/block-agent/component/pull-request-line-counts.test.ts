import type { ForeignEntity } from '@service-storage/generated/schemas';
import { expect, it } from 'vitest';
import { pullRequestLineCounts } from './pull-request-line-counts';

function entity(metadata: Record<string, unknown>): ForeignEntity {
  return {
    id: '019f0000-0000-7000-8000-000000000001',
    foreignEntityId: 'macro-inc/macro/pull/6303',
    foreignEntitySource: 'github_pull_request',
    metadata,
    storedForId: 'macro|wolf@macro.com',
    storedForAuthEntity: 'user',
    createdAt: '2026-09-11T00:00:00Z',
    updatedAt: '2026-09-11T00:00:00Z',
  };
}

it('reads added and deleted lines from a synced pull request', () => {
  expect(pullRequestLineCounts(entity({ status: 'open' }))).toBeUndefined();
  expect(
    pullRequestLineCounts(
      entity({ status: 'open', additions: 12, deletions: 3 })
    )
  ).toEqual({ additions: 12, deletions: 3 });
  expect(
    pullRequestLineCounts(
      entity({ status: 'open', additions: 0, deletions: 0 })
    )
  ).toBeUndefined();
  expect(
    pullRequestLineCounts(
      entity({ status: 'open', additions: 0, deletions: 5 })
    )
  ).toEqual({ additions: 0, deletions: 5 });
  expect(pullRequestLineCounts(undefined)).toBeUndefined();
  expect(
    pullRequestLineCounts({
      ...entity({ additions: 1, deletions: 1 }),
      foreignEntitySource: 'linear_issue',
    })
  ).toBeUndefined();
});
