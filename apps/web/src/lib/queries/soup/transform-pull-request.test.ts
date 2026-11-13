import type { SoupApiItem } from '@service-storage/generated/schemas';
import { expect, it, vi } from 'vitest';
import { mapApiSoupItemToEntity } from './transform-utils';

vi.mock('@core/constant/allBlocks', () => ({
  blockNameToDefaultFile: {},
  itemToSafeName: vi.fn(),
}));
vi.mock('@core/context/channels', () => ({ useChannelsContext: vi.fn() }));
vi.mock('@core/user', () => ({ emailToId: vi.fn() }));

it('retains review requests, latest reviews, and closing details on Reviews rows', () => {
  const metadata = {
    githubKey: 'owner/repo/pull/7',
    owner: 'owner',
    repo: 'repo',
    number: 7,
    url: 'https://github.com/owner/repo/pull/7',
    displayName: 'owner/repo#7',
    status: 'merged',
    draft: false,
    requestedReviewerGithubUserIds: ['42'],
    reviews: [
      {
        reviewerGithubUserId: '43',
        state: 'approved',
        submittedAt: '2026-11-01T10:00:00Z',
      },
    ],
    reviewDecision: 'approved',
    mergedBy: { githubUserId: '7', login: 'merger' },
    closedBy: { githubUserId: '8', login: 'closer' },
    mergedAt: '2026-11-01T12:00:00Z',
    closedAt: '2026-11-01T12:00:00Z',
  };
  const item: SoupApiItem = {
    tag: 'foreignEntity',
    frecency_score: 0,
    is_favorited: false,
    data: {
      id: 'pr',
      foreignEntityId: metadata.githubKey,
      foreignEntitySource: 'github_pull_request',
      storedForId: 'viewer',
      storedForAuthEntity: 'user',
      createdAt: '2026-11-01T10:00:00Z',
      updatedAt: '2026-11-01T12:00:00Z',
      metadata,
    },
  };
  expect(mapApiSoupItemToEntity(item)).toMatchObject({
    metadata: {
      requestedReviewerGithubUserIds: ['42'],
      reviews: metadata.reviews,
      reviewDecision: 'approved',
      draft: false,
      mergedBy: metadata.mergedBy,
      closedBy: metadata.closedBy,
      mergedAt: metadata.mergedAt,
      closedAt: metadata.closedAt,
    },
  });
});
