import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pullRequestChangesQueryOptions } from './pull-request-changes';

vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { getPullRequestChanges: vi.fn() },
}));

const read = vi.mocked(agentHarnessServiceClient.getPullRequestChanges);
const url = 'https://github.com/macro-inc/macro/pull/42';

beforeEach(() => vi.clearAllMocks());

describe('standalone pull request changes', () => {
  it('requests a canonical PR URL without requiring a coding session', async () => {
    const snapshot = {
      changeset: {
        id: 'snapshot-1',
        source: 'github_pull_request' as const,
        base: { name: 'release' },
        head: { name: 'fix' },
        files: [],
        additions: 0,
        deletions: 0,
        patchBytes: 0,
        truncated: false,
        capturedAt: '2026-09-26T00:00:00Z',
      },
      patch: '',
    };
    read.mockResolvedValue(ok(snapshot));
    expect(
      await pullRequestChangesQueryOptions(`${url}/files#diff-1`).queryFn()
    ).toBe(snapshot);
    expect(read).toHaveBeenCalledWith(url);
  });

  it('does not fetch absent, invalid, or hidden pull requests', () => {
    for (const missing of [undefined, 'not a pull request']) {
      expect(pullRequestChangesQueryOptions(missing).enabled).toBe(false);
    }
    expect(pullRequestChangesQueryOptions(url, false).enabled).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('isolates PR caches while sharing links to the same PR', () => {
    expect(pullRequestChangesQueryOptions(`${url}/files`).queryKey).toEqual(
      pullRequestChangesQueryOptions(url).queryKey
    );
    expect(pullRequestChangesQueryOptions(url).queryKey).not.toEqual(
      pullRequestChangesQueryOptions(`${url}1`).queryKey
    );
  });

  it('preserves a repository access error instead of returning an empty diff', async () => {
    read.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'Repository access denied' }])
    );
    await expect(
      pullRequestChangesQueryOptions(url).queryFn()
    ).rejects.toThrow();
  });
});
