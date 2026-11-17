/** @vitest-environment jsdom */
import { agentReviewClient } from '@service-agent-harness/reviews';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createSignal, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Review } from '../core/review';
import { type ReviewUpdates, useReview, useReviewActions } from './reviews';

vi.mock('@service-agent-harness/reviews', () => ({
  agentReviewClient: { get: vi.fn(), decide: vi.fn() },
}));

function saved(revision: number, status: 'pending' | 'completed'): Review {
  return {
    id: 'review',
    sessionId: 'session',
    actingUser: 'macro|owner@macro.local',
    executionId: null,
    kind: 'email',
    title: 'Review',
    revision,
    updatedAt: revision,
    presentedAt: 1,
    decision: null,
    items: [
      {
        id: 'item',
        draft: { subject: 'Hello', body: '', to: [{ email: 'a@example.com' }] },
        status,
        error: null,
        result: null,
      },
    ],
  };
}

const clients: QueryClient[] = [];
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function mount(updates: ReviewUpdates) {
  const client = new QueryClient();
  clients.push(client);
  let actions!: ReturnType<typeof useReviewActions>;
  function Card() {
    const query = useReview(
      () => 'session',
      () => 'review',
      () => updates
    );
    actions = useReviewActions(
      () => 'session',
      () => 'review'
    );
    return (
      <output>
        {query.data?.revision}:{query.data?.items[0].status}
      </output>
    );
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Loading</p>}>
        <Card />
      </Suspense>
    </QueryClientProvider>
  ));
  return () => actions;
}

describe('useReview', () => {
  it('fetches an announced revision and makes no requests between announcements', async () => {
    const [announced, setAnnounced] = createSignal<number>();
    vi.mocked(agentReviewClient.get).mockResolvedValue(ok(saved(1, 'pending')));
    mount({ kind: 'announced', revision: announced });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('1:pending')
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(agentReviewClient.get).toHaveBeenCalledTimes(1);

    // Its own announcement is no news.
    setAnnounced(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agentReviewClient.get).toHaveBeenCalledTimes(1);

    vi.mocked(agentReviewClient.get).mockResolvedValue(
      ok(saved(2, 'completed'))
    );
    setAnnounced(2);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('2:completed')
    );
    expect(agentReviewClient.get).toHaveBeenCalledTimes(2);
  });

  it('leaves the revision its own save commits to that save', async () => {
    const [announced, setAnnounced] = createSignal<number>();
    vi.mocked(agentReviewClient.get).mockResolvedValue(ok(saved(1, 'pending')));
    const actions = mount({ kind: 'announced', revision: announced });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('1:pending')
    );
    const response =
      Promise.withResolvers<
        Awaited<ReturnType<typeof agentReviewClient.decide>>
      >();
    vi.mocked(agentReviewClient.decide).mockReturnValue(response.promise);

    const decided = actions().decide({
      action: 'submit',
      revision: 1,
      items: [],
    });
    // The save's announcement can arrive before its response.
    setAnnounced(2);
    await vi.advanceTimersByTimeAsync(10_000);
    response.resolve(ok(saved(2, 'completed')));
    await decided;

    expect(screen.getByRole('status').textContent).toBe('2:completed');
    expect(agentReviewClient.get).toHaveBeenCalledTimes(1);
  });

  it('polls a pending review where nothing announces its changes', async () => {
    vi.mocked(agentReviewClient.get).mockResolvedValue(ok(saved(1, 'pending')));
    mount({ kind: 'polled' });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('1:pending')
    );

    vi.mocked(agentReviewClient.get).mockResolvedValue(
      ok(saved(2, 'completed'))
    );
    await vi.advanceTimersByTimeAsync(2_000);
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('2:completed')
    );

    // Nothing can change a finished review, so polling stops.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(agentReviewClient.get).toHaveBeenCalledTimes(2);
  });
});
