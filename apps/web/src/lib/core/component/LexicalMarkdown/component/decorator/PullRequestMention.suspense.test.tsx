import {
  githubLinkStatusQueryOptions,
  invalidateGithubLinkStatus,
} from '@queries/auth/github-link';
import type { authServiceClient } from '@service-auth/client';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal, Show, Suspense } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { checkGithubLinkStatus } = vi.hoisted(() => ({
  checkGithubLinkStatus:
    vi.fn<typeof authServiceClient.checkGithubLinkStatus>(),
}));

vi.mock('@service-auth/client', () => ({
  authServiceClient: { checkGithubLinkStatus },
}));
vi.mock('@queries/soup/normalized-cache', () => ({
  invalidateAllSoup: vi.fn(),
}));

let client: QueryClient;
vi.mock('@queries/client', () => ({
  get queryClient() {
    return client;
  },
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: vi.fn() }),
}));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
// PR details stay unresolved so this exercises the stored label independently
// of the real GitHub connection-status query and its retry lifecycle.
vi.mock('@queries/storage/pr-mention', () => ({
  usePrMentionQuery: () => ({ isSuccess: false }),
  usePullRequestByGithubKeyQuery: () => ({ isSuccess: false }),
}));
vi.mock('../../plugins', () => ({ autoRegister: vi.fn() }));
vi.mock('../../context/LexicalWrapperContext', async () => ({
  LexicalWrapperContext: (await import('solid-js')).createContext(),
}));

import { PullRequestMention } from './PullRequestMention';

beforeEach(() => {
  checkGithubLinkStatus.mockReset();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('PR mention connection-status suspense', () => {
  it('keeps a confirmed plain link through refetch errors and remounts', async () => {
    checkGithubLinkStatus.mockResolvedValueOnce(
      err([{ code: 'NOT_FOUND', message: 'GitHub account not linked' }])
    );
    await client.fetchQuery(githubLinkStatusQueryOptions());
    const [mounted, setMounted] = createSignal(true);
    const suspended = vi.fn();
    function HiddenSurface() {
      suspended();
      return <span>Hidden surface</span>;
    }
    render(() => (
      <QueryClientProvider client={client}>
        <Suspense fallback={<HiddenSurface />}>
          <Show when={mounted()}>
            <PullRequestMention
              id="pr-1"
              url="https://github.com/macro-inc/macro/pull/7956"
              label="macro-inc/macro#7956"
              key="sent"
              theme={{}}
            />
          </Show>
        </Suspense>
      </QueryClientProvider>
    ));
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      'https://github.com/macro-inc/macro/pull/7956'
    );
    checkGithubLinkStatus.mockResolvedValueOnce(
      err([{ code: 'HTTP_ERROR', message: 'Connection status unavailable' }])
    );
    await expect(
      client.fetchQuery({ ...githubLinkStatusQueryOptions(), staleTime: 0 })
    ).rejects.toThrow();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      'https://github.com/macro-inc/macro/pull/7956'
    );
    setMounted(false);
    setMounted(true);
    expect(screen.getByRole('link')).toBeDefined();
    expect(suspended).not.toHaveBeenCalled();
  });

  it.each(['linked', 'unlinked', 'error'] as const)(
    'keeps the composer and message visible during a retry that ends %s',
    async (outcome) => {
      checkGithubLinkStatus.mockResolvedValueOnce(
        err([{ code: 'HTTP_ERROR', message: 'Connection status unavailable' }])
      );
      await expect(
        client.fetchQuery(githubLinkStatusQueryOptions())
      ).rejects.toThrow();

      const retry =
        Promise.withResolvers<
          Awaited<ReturnType<typeof authServiceClient.checkGithubLinkStatus>>
        >();
      checkGithubLinkStatus.mockReturnValueOnce(retry.promise);
      const [inserted, setInserted] = createSignal(false);
      const suspended = vi.fn();
      function HiddenSurface() {
        suspended();
        return <span>Hidden surface</span>;
      }

      render(() => (
        <QueryClientProvider client={client}>
          <Suspense fallback={<HiddenSurface />}>
            <div contentEditable role="textbox" aria-label="Composer">
              Draft text
              <Show when={inserted()}>
                <PullRequestMention
                  id="pr-1"
                  url="https://github.com/macro-inc/macro/pull/7956"
                  label="macro-inc/macro#7956"
                  key="draft"
                  theme={{}}
                />
              </Show>
            </div>
          </Suspense>
          <Suspense fallback={<HiddenSurface />}>
            <Show when={inserted()}>
              <div data-testid="message">
                Sent message
                <PullRequestMention
                  id="pr-1"
                  url="https://github.com/macro-inc/macro/pull/7956"
                  label="macro-inc/macro#7956"
                  key="sent"
                  theme={{}}
                />
              </div>
            </Show>
          </Suspense>
        </QueryClientProvider>
      ));
      const composer = screen.getByRole('textbox');
      composer.focus();
      setInserted(true);

      expect(checkGithubLinkStatus).toHaveBeenCalledTimes(1);
      setInserted(false);
      setInserted(true);
      expect(checkGithubLinkStatus).toHaveBeenCalledTimes(1);

      // An explicit retry still works and must not suspend either surface.
      const settled = client.fetchQuery(githubLinkStatusQueryOptions());
      expect(checkGithubLinkStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('textbox')).toBe(composer);
      expect(document.activeElement).toBe(composer);
      expect(screen.getByTestId('message').textContent).toContain(
        'macro-inc/macro#7956'
      );
      expect(suspended).not.toHaveBeenCalled();

      const response =
        outcome === 'linked'
          ? ok({
              github_user_id: '123',
              github_username: 'macro-user',
              reauthentication_required: false,
            })
          : err([
              {
                code: outcome === 'unlinked' ? 'NOT_FOUND' : 'HTTP_ERROR',
                message: 'Connection status unavailable',
              } as const,
            ]);
      retry.resolve(response);
      if (outcome === 'error') {
        await expect(settled).rejects.toThrow();
      } else {
        await settled;
      }
      // Solid Query delivers observer updates through a queued resource refetch.
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      expect(screen.getByRole('textbox')).toBe(composer);
      expect(screen.getByTestId('message')).toBeDefined();
      expect(suspended).not.toHaveBeenCalled();
      expect(composer.querySelector('[data-pr-mention]') !== null).toBe(
        outcome !== 'unlinked'
      );
      expect(
        screen.getByTestId('message').querySelector('[data-pr-mention]') !==
          null
      ).toBe(outcome !== 'unlinked');
    }
  );
});

it('refreshes a failed inactive status query after OAuth completes', async () => {
  checkGithubLinkStatus.mockResolvedValueOnce(
    err([{ code: 'HTTP_ERROR', message: 'Connection status unavailable' }])
  );
  await expect(
    client.fetchQuery(githubLinkStatusQueryOptions())
  ).rejects.toThrow();
  checkGithubLinkStatus.mockResolvedValueOnce(
    ok({
      github_user_id: '123',
      github_username: 'macro-user',
      reauthentication_required: false,
    })
  );

  await invalidateGithubLinkStatus();

  expect(checkGithubLinkStatus).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(githubLinkStatusQueryOptions().queryKey)).toEqual({
    status: 'linked',
    username: 'macro-user',
    userId: '123',
  });
});

it('refreshes a failed status query after OAuth when all observers are disabled', async () => {
  checkGithubLinkStatus.mockResolvedValueOnce(
    err([{ code: 'HTTP_ERROR', message: 'Connection status unavailable' }])
  );
  await expect(
    client.fetchQuery(githubLinkStatusQueryOptions())
  ).rejects.toThrow();
  const observer = new QueryObserver(client, {
    ...githubLinkStatusQueryOptions(),
    enabled: false,
    retryOnMount: false,
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    checkGithubLinkStatus.mockResolvedValueOnce(
      ok({
        github_user_id: '123',
        github_username: 'macro-user',
        reauthentication_required: false,
      })
    );
    await invalidateGithubLinkStatus();
    expect(checkGithubLinkStatus).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data?.status).toBe('linked');
  } finally {
    unsubscribe();
  }
});

it('does not reuse an in-flight pre-OAuth status request', async () => {
  const previous =
    Promise.withResolvers<
      Awaited<ReturnType<typeof authServiceClient.checkGithubLinkStatus>>
    >();
  checkGithubLinkStatus.mockReturnValueOnce(previous.promise);
  const pending = client.fetchQuery(githubLinkStatusQueryOptions());
  // Cancellation is expected; attach a handler before refreshing.
  const previousSettled = Promise.allSettled([pending]);
  checkGithubLinkStatus.mockResolvedValueOnce(
    ok({
      github_user_id: '123',
      github_username: 'macro-user',
      reauthentication_required: false,
    })
  );
  const refreshed = invalidateGithubLinkStatus();
  previous.resolve(
    err([{ code: 'NOT_FOUND', message: 'GitHub account not linked' }])
  );
  await previousSettled;
  await refreshed;

  expect(checkGithubLinkStatus).toHaveBeenCalledTimes(2);
  expect(
    client.getQueryData(githubLinkStatusQueryOptions().queryKey)
  ).toMatchObject({ status: 'linked' });
});

it('does not report a post-OAuth status failure as an OAuth failure', async () => {
  checkGithubLinkStatus.mockResolvedValue(
    err([{ code: 'HTTP_ERROR', message: 'Connection status unavailable' }])
  );
  await expect(invalidateGithubLinkStatus()).resolves.toBeUndefined();
  expect(
    client.getQueryState(githubLinkStatusQueryOptions().queryKey)?.status
  ).toBe('error');
});
