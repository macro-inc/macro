import { authServiceClient } from '@service-auth/client';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pullRequestStatsQueryOptions } from './pull-request-stats';

vi.mock('@service-auth/client', () => ({
  authServiceClient: { enrichGithubPullRequests: vi.fn() },
}));

const reference = {
  owner: 'macro-inc',
  repo: 'macro',
  number: 42,
  githubKey: 'macro-inc/macro/pull/42',
  displayName: 'macro-inc/macro#42',
  url: 'https://github.com/macro-inc/macro/pull/42',
};
const enrich = vi.mocked(authServiceClient.enrichGithubPullRequests);

beforeEach(() => vi.clearAllMocks());

describe('GitHub PR statistics', () => {
  it('requests the linked PR and returns GitHub totals unchanged', async () => {
    enrich.mockResolvedValue(
      ok({ pullRequests: [{ ...reference, additions: 728, deletions: 193 }] })
    );
    expect(await pullRequestStatsQueryOptions(reference.url).queryFn()).toEqual(
      { additions: 728, deletions: 193 }
    );
    expect(enrich).toHaveBeenCalledWith({ pullRequests: [reference] });
  });

  it('preserves real zero totals', async () => {
    enrich.mockResolvedValue(
      ok({ pullRequests: [{ ...reference, additions: 0, deletions: 0 }] })
    );
    expect(await pullRequestStatsQueryOptions(reference.url).queryFn()).toEqual(
      { additions: 0, deletions: 0 }
    );
  });

  it('treats missing enrichment as unavailable rather than zero', async () => {
    enrich.mockResolvedValue(ok({ pullRequests: [reference] }));
    expect(
      await pullRequestStatsQueryOptions(reference.url).queryFn()
    ).toBeNull();
  });

  it('does not substitute another PR or partial counts', async () => {
    enrich.mockResolvedValue(
      ok({
        pullRequests: [
          {
            ...reference,
            githubKey: 'other/repo/pull/1',
            additions: 8,
            deletions: 9,
          },
        ],
      })
    );
    expect(
      await pullRequestStatsQueryOptions(reference.url).queryFn()
    ).toBeNull();
    enrich.mockResolvedValue(
      ok({ pullRequests: [{ ...reference, additions: 8, deletions: null }] })
    );
    expect(
      await pullRequestStatsQueryOptions(reference.url).queryFn()
    ).toBeNull();
  });

  it('does not request statistics without a PR', async () => {
    for (const url of [undefined, 'not a PR']) {
      const query = pullRequestStatsQueryOptions(url);
      expect(query.enabled).toBe(false);
      expect(await query.queryFn()).toBeNull();
    }
    expect(enrich).not.toHaveBeenCalled();
  });

  it('propagates GitHub authentication errors without inventing totals', async () => {
    enrich.mockResolvedValue(
      err([{ code: 'REAUTHENTICATION_REQUIRED', message: 'Reconnect GitHub' }])
    );
    await expect(
      pullRequestStatsQueryOptions(reference.url).queryFn()
    ).rejects.toThrow();
  });

  it('isolates PRs and captures and periodically refreshes GitHub', () => {
    const first = pullRequestStatsQueryOptions(reference.url, 'capture-1');
    expect(first.queryKey).not.toEqual(
      pullRequestStatsQueryOptions(reference.url, 'capture-2').queryKey
    );
    expect(first.queryKey).not.toEqual(
      pullRequestStatsQueryOptions(
        'https://github.com/macro-inc/macro/pull/43',
        'capture-1'
      ).queryKey
    );
    expect(first.refetchInterval).toBe(30_000);
  });
});
