import {
  createFakeFeedbackClient,
  httpFailure,
} from '@app/features/agent-feedback/tests/fake-client';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftOriginBar } from './components/draft-origin-bar';
import { DoneRow } from './components/suggestion-row';
import { doneSuggestion, draftedReplySuggestion } from './tests/fixtures';
import { HomePrioritiesView } from './views/home-priorities-view';

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
  isRefusal: (errors: { code: string }[]) =>
    errors.some((error) => error.code === 'NOT_FOUND'),
}));

const { SuggestionFeedback } = await import('./suggestion-feedback');

function renderWithQueries(ui: () => JSX.Element) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(() => (
    <QueryClientProvider client={queryClient}>{ui()}</QueryClientProvider>
  ));
}

function renderPriorities() {
  renderWithQueries(() => (
    <HomePrioritiesView
      priorities={[doneSuggestion, draftedReplySuggestion]}
      feedback={(suggestionId) => (
        <SuggestionFeedback
          suggestionId={suggestionId}
          surface="suggestion_tile"
        />
      )}
      onOpenEvent={() => undefined}
      onOpenSuggestion={() => undefined}
      onOpenAll={() => undefined}
    />
  ));
}

beforeEach(() => {
  // The note dialog scrolls its field into view, which jsdom lacks.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  mocks.fake = createFakeFeedbackClient();
  mocks.flag = { enabled: false, loading: false };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('suggestion feedback', () => {
  it('rates a Home priority as a suggestion tile', async () => {
    mocks.flag = { enabled: true, loading: false };
    renderPriorities();

    const good = await screen.findAllByRole('button', {
      name: 'Good response',
    });
    expect(good).toHaveLength(2);
    expect(mocks.fake?.client.mine).toHaveBeenCalledWith({
      kind: 'suggestion',
      suggestionId: doneSuggestion.id,
    });
    expect(mocks.fake?.client.mine).toHaveBeenCalledWith({
      kind: 'suggestion',
      suggestionId: draftedReplySuggestion.id,
    });

    fireEvent.click(good[1] as HTMLElement);
    await vi.waitFor(() =>
      expect(mocks.fake?.client.rate).toHaveBeenCalledWith(
        { kind: 'suggestion', suggestionId: draftedReplySuggestion.id },
        expect.objectContaining({
          rating: 'up',
          note: null,
          surface: 'suggestion_tile',
        })
      )
    );
    mocks.fake?.release();
  });

  it('leaves the rows as they were while the flag is off', async () => {
    renderPriorities();
    await Promise.resolve();

    expect(screen.queryByRole('button', { name: 'Good response' })).toBeNull();
    expect(mocks.fake?.client.mine).not.toHaveBeenCalled();
  });

  it('offers nothing where the server refuses feedback', async () => {
    mocks.flag = { enabled: true, loading: false };
    mocks.fake?.client.mine.mockResolvedValue(httpFailure('NOT_FOUND'));
    renderPriorities();

    await vi.waitFor(() =>
      expect(mocks.fake?.client.mine).toHaveBeenCalledTimes(2)
    );
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Good response' })).toBeNull();
  });

  it('rates a finished For you row and a reply draft by their surfaces', async () => {
    mocks.flag = { enabled: true, loading: false };
    renderWithQueries(() => (
      <>
        <DoneRow
          suggestion={doneSuggestion}
          feedback={
            <SuggestionFeedback
              suggestionId={doneSuggestion.id}
              surface="suggestion_row"
            />
          }
          onOpen={() => undefined}
        />
        <DraftOriginBar
          onRewrite={() => undefined}
          feedback={
            <SuggestionFeedback
              suggestionId={draftedReplySuggestion.id}
              surface="suggestion_draft"
            />
          }
        />
      </>
    ));

    const bad = await screen.findAllByRole('button', { name: 'Bad response' });
    expect(bad).toHaveLength(2);
    fireEvent.click(bad[0] as HTMLElement);
    fireEvent.click(bad[1] as HTMLElement);

    await vi.waitFor(() =>
      expect(mocks.fake?.client.rate).toHaveBeenCalledTimes(2)
    );
    expect(mocks.fake?.client.rate).toHaveBeenCalledWith(
      { kind: 'suggestion', suggestionId: doneSuggestion.id },
      expect.objectContaining({ rating: 'down', surface: 'suggestion_row' })
    );
    expect(mocks.fake?.client.rate).toHaveBeenCalledWith(
      { kind: 'suggestion', suggestionId: draftedReplySuggestion.id },
      expect.objectContaining({ rating: 'down', surface: 'suggestion_draft' })
    );
    mocks.fake?.release();
  });
});
