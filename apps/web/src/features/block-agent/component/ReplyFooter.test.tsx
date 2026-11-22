import { createFakeFeedbackClient } from '@app/features/agent-feedback/tests/fake-client';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  flag: { enabled: false, loading: false },
  fake: undefined as
    | ReturnType<
        typeof import('@app/features/agent-feedback/tests/fake-client').createFakeFeedbackClient
      >
    | undefined,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ ...mocks.flag, payload: undefined }),
}));
vi.mock('@app/features/agent-feedback/queries/client', () => ({
  get agentFeedbackClient() {
    return mocks.fake?.client;
  },
  isRefusal: () => false,
}));

const { ResponseFeedback } = await import(
  '@app/features/agent-feedback/agent-feedback'
);
const { ReplyFooter } = await import('./PromptFooter');

const TURN = {
  kind: 'agent_session_turn',
  sessionId: 'session-1',
  turn: 2,
} as const;

function renderFooter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(() => (
    <QueryClientProvider client={queryClient}>
      <ReplyFooter sentAt="2026-11-22T10:00:00Z">
        <ResponseFeedback subject={TURN} surface="agents_view" />
      </ReplyFooter>
    </QueryClientProvider>
  ));
  return screen.getByTestId('reply-footer');
}

beforeEach(() => {
  mocks.fake = createFakeFeedbackClient();
  mocks.flag = { enabled: false, loading: false };
});

afterEach(cleanup);

describe('ReplyFooter with reply feedback', () => {
  it('keeps the plain footer while the flag is off', async () => {
    const footer = renderFooter();
    await Promise.resolve();

    expect(footer.classList.contains('flex')).toBe(false);
    expect(footer.className).toBe('text-xs text-ink-extra-muted');
    expect(mocks.fake?.client.mine).not.toHaveBeenCalled();
  });

  it('lays the thumbs out beside the time while the flag is on', async () => {
    mocks.flag = { enabled: true, loading: false };
    const footer = renderFooter();

    await screen.findByRole('button', { name: 'Good response' });
    expect(footer.classList.contains('flex')).toBe(true);
    expect(footer.classList.contains('items-center')).toBe(true);
  });
});
