/**
 * @vitest-environment jsdom
 */

import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DOCUMENT_ID = '019f148f-2a38-7f56-8944-ee118e48d27c';

const mocks = vi.hoisted(() => ({
  authenticated: true as boolean | undefined,
  getDocumentByTeamSlug: vi.fn(),
  navigate: vi.fn(),
  taskSlug: 'ENG-42',
}));

vi.mock('@core/auth', () => ({
  useIsAuthenticated: () => () => mocks.authenticated,
}));

vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading task…</div>,
}));

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getDocumentByTeamSlug: mocks.getDocumentByTeamSlug,
  },
}));

vi.mock('@solidjs/router', () => ({
  // Mirrors the real Navigate component: a replace navigation on render.
  Navigate: (props: { href: string }) => {
    mocks.navigate(props.href, { replace: true });
    return null;
  },
  useNavigate: () => mocks.navigate,
  useParams: () => ({
    get taskSlug() {
      return mocks.taskSlug;
    },
  }),
}));

vi.mock('@ui', () => ({
  Button: (props: { children: JSX.Element; onClick?: () => void }) => (
    <button onClick={props.onClick}>{props.children}</button>
  ),
}));

import { TaskRoute } from './TaskRoute';

let dispose: (() => void) | undefined;

function renderRoute(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // No retry override: the hook itself must disable retries so deterministic
  // resolution failures surface immediately.
  const queryClient = new QueryClient();
  const disposeRender = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <TaskRoute />
      </QueryClientProvider>
    ),
    container
  );
  dispose = () => {
    disposeRender();
    queryClient.clear();
    container.remove();
  };
  return container;
}

beforeEach(() => {
  mocks.authenticated = true;
  mocks.taskSlug = 'ENG-42';
  mocks.navigate.mockReset();
  mocks.getDocumentByTeamSlug.mockReset();
  mocks.getDocumentByTeamSlug.mockResolvedValue(
    ok({ documentMetadata: { documentId: DOCUMENT_ID } })
  );
  sessionStorage.clear();
  window.history.replaceState({}, '', '/app/task-slug/ENG-42');
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
});

describe('TaskRoute', () => {
  it('rejects an invalid task slug without resolving it', async () => {
    mocks.taskSlug = 'ENG-0';

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Task not found');
    });
    expect(mocks.getDocumentByTeamSlug).not.toHaveBeenCalled();
  });

  it('resolves a team task slug and replaces it with the canonical task route', async () => {
    renderRoute();

    await vi.waitFor(() => {
      expect(mocks.getDocumentByTeamSlug).toHaveBeenCalledWith({
        slug: 'ENG-42',
        signal: expect.any(AbortSignal),
      });
      expect(mocks.navigate).toHaveBeenCalledWith(`/task/${DOCUMENT_ID}`, {
        replace: true,
      });
    });
  });

  it('preserves the slug route while sending a signed-out user to login', async () => {
    mocks.authenticated = false;

    renderRoute();

    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith('/login', { replace: true });
    });
    expect(sessionStorage.getItem('redirectUrl')).toBe(window.location.href);
    expect(mocks.getDocumentByTeamSlug).not.toHaveBeenCalled();
  });

  it('shows a not-found state for an unknown task reference', async () => {
    mocks.getDocumentByTeamSlug.mockResolvedValue(
      err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
    );

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Task not found');
    });
    expect(mocks.getDocumentByTeamSlug).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('shows the not-found state when the user has no team access', async () => {
    mocks.getDocumentByTeamSlug.mockResolvedValue(
      err([{ code: 'FORBIDDEN', message: 'Forbidden' }])
    );

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Task not found');
    });
    expect(container.textContent).not.toContain('Try again');
  });

  it('recovers from a transient error through the retry button', async () => {
    let releaseRefetch = (): void => undefined;
    mocks.getDocumentByTeamSlug
      .mockResolvedValueOnce(
        err([{ code: 'SERVER_ERROR', message: 'Internal server error' }])
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseRefetch = () =>
              resolve(ok({ documentMetadata: { documentId: DOCUMENT_ID } }));
          })
      );

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Unable to open task');
    });

    const retryButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Try again'
    );
    expect(retryButton).toBeDefined();
    retryButton?.click();

    // While the refetch is in flight the error state yields to the loading
    // state instead of leaving the retry click without feedback.
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Loading task…');
    });

    releaseRefetch();
    await vi.waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith(`/task/${DOCUMENT_ID}`, {
        replace: true,
      });
    });
  });

  it('shows a retryable error when a success payload has no document id', async () => {
    mocks.getDocumentByTeamSlug.mockResolvedValue(
      ok({ documentMetadata: { documentId: '' } })
    );

    const container = renderRoute();

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Unable to open task');
    });
    expect(container.textContent).toContain('Try again');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
