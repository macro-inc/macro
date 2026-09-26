import { ThrownResultError } from '@core/util/result';
import type { PullRequestChangesResponse } from '@service-agent-harness/generated/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPullRequestChangesSource } from './pull-request-changes';

const query = vi.hoisted(() => ({
  isPending: true,
  isSuccess: false,
  isError: false,
  error: null as unknown,
  errorUpdatedAt: 0,
  fetchStatus: 'fetching',
  data: undefined as PullRequestChangesResponse | undefined,
  refetch: vi.fn(),
}));

vi.mock('@tanstack/solid-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/solid-query')>()),
  useQuery: () => query,
}));

const snapshot: PullRequestChangesResponse = {
  changeset: {
    id: 'snapshot-1',
    source: 'github_pull_request',
    base: { name: 'main' },
    head: { name: 'fix' },
    files: [],
    additions: 1,
    deletions: 0,
    patchBytes: 5,
    truncated: false,
    capturedAt: '2026-09-26T00:00:00Z',
  },
  patch: 'patch',
};

beforeEach(() => {
  Object.assign(query, {
    isPending: true,
    isSuccess: false,
    isError: false,
    error: null,
    errorUpdatedAt: 0,
    fetchStatus: 'fetching',
    data: undefined,
  });
  vi.clearAllMocks();
});

describe('pull request changes source', () => {
  it('avoids reading pending query data, including disabled queries', () => {
    const readData = vi.spyOn(query, 'data', 'get').mockImplementation(() => {
      throw new Error('Pending data read would suspend');
    });
    const source = createPullRequestChangesSource(() => undefined);
    expect(source.summary()).toBeUndefined();
    expect(readData).not.toHaveBeenCalled();
    query.fetchStatus = 'idle';
    expect(source.summaryStatus()).toBe('idle');
    expect(source.summary()).toBeUndefined();
    readData.mockRestore();
  });

  it('shows repository access errors on the initial read', () => {
    Object.assign(query, {
      isPending: false,
      isError: true,
      error: new ThrownResultError([
        { code: 'HTTP_ERROR', message: 'Check its repository access.' },
      ]),
    });
    const source = createPullRequestChangesSource(
      () => 'https://github.com/o/r/pull/1'
    );
    expect(source.summary()?.attempt).toMatchObject({
      outcome: 'failed',
      error: 'Check its repository access.',
    });
    expect(source.summary()?.changeset).toBeUndefined();
  });

  it('keeps the last coherent snapshot visible after a refresh failure', () => {
    Object.assign(query, {
      isPending: false,
      isSuccess: true,
      data: snapshot,
    });
    const source = createPullRequestChangesSource(
      () => 'https://github.com/o/r/pull/1'
    );
    const patch = source.patch(
      () => 'snapshot-1',
      () => true
    );
    expect(patch.text()).toBe('patch');

    Object.assign(query, {
      isSuccess: false,
      isError: true,
      error: new Error('offline'),
    });
    expect(source.summary()?.changeset?.id).toBe('snapshot-1');
    expect(source.summary()?.attempt?.outcome).toBe('failed');
    expect(patch.text()).toBe('patch');
    expect(patch.status()).toBe('success');
    expect(
      source
        .patch(
          () => 'new-snapshot',
          () => true
        )
        .text()
    ).toBeUndefined();
  });
});
