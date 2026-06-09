import { err as resultErr, ok as resultOk } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enrichGithubPullRequests: vi.fn(),
  getDocumentGithubPullRequests: vi.fn(),
}));

vi.mock('@service-auth/client', () => ({
  authServiceClient: {
    enrichGithubPullRequests: mocks.enrichGithubPullRequests,
  },
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getDocumentGithubPullRequests: mocks.getDocumentGithubPullRequests,
  },
}));

import type { ResultError } from '@core/util/result';
import type { EnrichedGithubPullRequest } from '@service-auth/generated/schemas';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { fetchDocumentGithubPullRequests } from './github-pull-requests';

const rawPullRequest: GithubPullRequest = {
  displayName: 'macro/macro#42',
  githubKey: 'macro/macro/pull/42',
  number: 42,
  owner: 'macro',
  repo: 'macro',
  url: 'https://github.com/macro/macro/pull/42',
};

const rawResponse = { pullRequests: [rawPullRequest] };

const storageMetadataPullRequest: GithubPullRequest = {
  ...rawPullRequest,
  additions: 12,
  checks: [
    {
      conclusion: 'success',
      id: 1001,
      name: 'build',
      status: 'completed',
    },
  ],
  comments: [
    {
      body: 'Stored review comment',
      id: 2001,
      source: 'review_comment',
    },
  ],
  deletions: 3,
  foreignEntityId: 'foreign-entity-1',
  name: 'Stored GitHub metadata',
  status: 'open',
};

function createError(code: string): ResultError<string> {
  return { code, message: code };
}

function createShallowAuthPullRequest(
  pullRequest: GithubPullRequest
): EnrichedGithubPullRequest {
  return {
    displayName: pullRequest.displayName,
    githubKey: pullRequest.githubKey,
    number: pullRequest.number,
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    url: pullRequest.url,
  };
}

beforeEach(() => {
  mocks.enrichGithubPullRequests.mockReset();
  mocks.getDocumentGithubPullRequests.mockReset();

  mocks.getDocumentGithubPullRequests.mockResolvedValue(resultOk(rawResponse));
});

describe('fetchDocumentGithubPullRequests', () => {
  it('keeps the raw PR fallback for GitHub reauthentication enrichment errors', async () => {
    mocks.enrichGithubPullRequests.mockResolvedValue(
      resultErr([createError('REAUTHENTICATION_REQUIRED')])
    );

    const response = await fetchDocumentGithubPullRequests('document-1');

    expect(response).toEqual(rawResponse);
    expect(mocks.enrichGithubPullRequests).toHaveBeenCalledWith({
      pullRequests: [
        {
          displayName: rawPullRequest.displayName,
          githubKey: rawPullRequest.githubKey,
          number: rawPullRequest.number,
          owner: rawPullRequest.owner,
          repo: rawPullRequest.repo,
          url: rawPullRequest.url,
        },
      ],
    });
  });

  it('keeps the raw PR fallback for unrelated enrichment errors', async () => {
    mocks.enrichGithubPullRequests.mockResolvedValue(
      resultErr([createError('SERVER_ERROR')])
    );

    const response = await fetchDocumentGithubPullRequests('document-1');

    expect(response).toEqual(rawResponse);
  });

  it('returns enriched PRs when enrichment succeeds', async () => {
    const enrichedPullRequest: EnrichedGithubPullRequest = {
      ...rawPullRequest,
      additions: 10,
      deletions: 2,
      name: 'Improve GitHub auth',
      status: 'open',
    };
    mocks.enrichGithubPullRequests.mockResolvedValue(
      resultOk({ pullRequests: [enrichedPullRequest] })
    );

    const response = await fetchDocumentGithubPullRequests('document-1');

    expect(response).toEqual({ pullRequests: [enrichedPullRequest] });
  });

  it('preserves storage metadata when auth enrichment succeeds with a shallow PR', async () => {
    const shallowAuthPullRequest = createShallowAuthPullRequest(rawPullRequest);
    mocks.getDocumentGithubPullRequests.mockResolvedValue(
      resultOk({ pullRequests: [storageMetadataPullRequest] })
    );
    mocks.enrichGithubPullRequests.mockResolvedValue(
      resultOk({ pullRequests: [shallowAuthPullRequest] })
    );

    const response = await fetchDocumentGithubPullRequests('document-1');

    expect(response).toEqual({
      pullRequests: [storageMetadataPullRequest],
    });
  });

  it('uses auth enrichment metadata when present while preserving the foreign entity id', async () => {
    const enrichedPullRequest: EnrichedGithubPullRequest = {
      ...rawPullRequest,
      additions: 20,
      checks: [
        {
          conclusion: 'failure',
          id: 1002,
          name: 'build',
          status: 'completed',
        },
      ],
      comments: [
        {
          body: 'Fresh review comment',
          id: 2002,
          source: 'review_comment',
        },
      ],
      deletions: 5,
      name: 'Fresh GitHub metadata',
      status: 'closed',
    };
    mocks.getDocumentGithubPullRequests.mockResolvedValue(
      resultOk({ pullRequests: [storageMetadataPullRequest] })
    );
    mocks.enrichGithubPullRequests.mockResolvedValue(
      resultOk({ pullRequests: [enrichedPullRequest] })
    );

    const response = await fetchDocumentGithubPullRequests('document-1');

    expect(response).toEqual({
      pullRequests: [
        {
          ...enrichedPullRequest,
          foreignEntityId: storageMetadataPullRequest.foreignEntityId,
        },
      ],
    });
  });
});
