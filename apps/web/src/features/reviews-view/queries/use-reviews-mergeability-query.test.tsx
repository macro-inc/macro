/** @vitest-environment jsdom */
import type { GithubPullRequestNumber } from '@service-auth/generated/schemas';
import { render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';

const fetchMergeability = vi.hoisted(() => vi.fn());
vi.mock('@service-auth/client', () => ({
  authServiceClient: { getGithubPullRequestMergeability: fetchMergeability },
}));

import { useReviewsMergeabilityQuery } from './use-reviews-mergeability-query';

it('batches the current window and leaves unavailable conflicts unknown', async () => {
  fetchMergeability.mockImplementation(
    async (body: { pullRequests: GithubPullRequestNumber[] }) =>
      ok({
        pullRequests: body.pullRequests.map((request) => ({
          ...request,
          mergeability:
            request.number === 1
              ? 'conflicting'
              : request.number === 2
                ? 'unknown'
                : 'mergeable',
        })),
      })
  );
  const requests = Array.from({ length: 101 }, (_, index) => ({
    owner: 'owner',
    repo: 'repo',
    number: index + 1,
  }));
  const [visible, setVisible] = createSignal(requests);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let query!: ReturnType<typeof useReviewsMergeabilityQuery>;
  function Harness() {
    query = useReviewsMergeabilityQuery(visible, () => true);
    return null;
  }
  const view = render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  try {
    await vi.waitFor(() =>
      expect(query.hasConflicts(requests[100])).toBe(false)
    );
    expect(
      fetchMergeability.mock.calls.map(([body]) => body.pullRequests.length)
    ).toEqual([100, 1]);
    expect(query.hasConflicts(requests[0])).toBe(true);
    expect(query.hasConflicts(requests[1])).toBeUndefined();

    setVisible([]);
    expect(query.hasConflicts(requests[0])).toBeUndefined();
    expect(fetchMergeability).toHaveBeenCalledTimes(2);
  } finally {
    view.unmount();
    client.clear();
  }
});
