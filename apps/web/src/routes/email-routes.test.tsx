import {
  createMemoryHistory,
  createMemoryPaneStore,
  defineRoute,
  SplitRouter,
  type SplitRouter as SplitRouterInstance,
  useSplitRouter,
} from '@app/lib/split-router';
import { createTestPolicy } from '@app/lib/split-router/tests/fixtures';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { For, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { EmailRoutes } from './email-routes';

const thread = vi.hoisted(() => ({
  load: undefined as (() => void) | undefined,
}));

vi.mock('./lazy-route-views', async () => {
  const { lazy } = await import('solid-js');
  const { SplitRouter } = await import('@app/lib/split-router');
  return {
    MailRouteView: () => (
      <section aria-label="Email">
        <p>Email list</p>
        <SplitRouter.Outlet />
      </section>
    ),
    // A thread view whose code has not loaded yet.
    EmailDetailRouteView: lazy(
      () =>
        new Promise<{ default: () => JSX.Element }>((resolve) => {
          thread.load = () => resolve({ default: () => <p>Thread</p> });
        })
    ),
  };
});
// The app's route table imports half the app; these are the two shapes used.
vi.mock('./routes', async () => {
  const { defineRoute } = await import('@app/lib/split-router');
  const { z } = await import('zod');
  return {
    emailSplitRoute: defineRoute({ id: 'view-mail', path: 'mail' }),
    emailThreadRoute: defineRoute({
      id: 'mail-thread',
      path: ':threadId',
      params: z.object({ threadId: z.string().min(1) }),
    }),
  };
});
vi.mock('@app/features/email-view/email-view-skeleton', () => ({
  EmailViewSkeleton: () => <p>Email skeleton</p>,
}));
vi.mock('@components/app/ContentLoading', () => ({
  ContentLoading: () => <p>Thread loading</p>,
}));

afterEach(cleanup);

const app = defineRoute({ id: 'app' });

function Panes() {
  const router = useSplitRouter();
  return (
    <For each={router.panes()}>
      {(pane) => <SplitRouter.Outlet pane={pane} />}
    </For>
  );
}

it('opens a thread inside the Email view instead of replacing it with the skeleton', async () => {
  let router!: SplitRouterInstance;
  function Layout() {
    router = useSplitRouter();
    return <Panes />;
  }
  render(() => (
    <SplitRouter.Router
      history={createMemoryHistory('/mail')}
      paneStore={createMemoryPaneStore()}
      policy={createTestPolicy().policy}
      defaultRoute={() => ({ matches: [{ id: 'app', params: {} }] })}
    >
      <SplitRouter.Route definition={app} component={Layout}>
        <EmailRoutes />
      </SplitRouter.Route>
    </SplitRouter.Router>
  ));
  const list = await screen.findByText('Email list');

  await router.navigatePane(router.panes()[0]!, '/mail/thread-1');

  // The thread suspends to its own boundary; the list stays the same node.
  expect(await screen.findByText('Thread loading')).toBeTruthy();
  expect(screen.queryByText('Email skeleton')).toBeNull();
  expect(screen.getByText('Email list')).toBe(list);

  thread.load?.();
  expect(await screen.findByText('Thread')).toBeTruthy();
  expect(screen.getByText('Email list')).toBe(list);
});

it('loads the thread view with the Email view, so later opens never suspend', async () => {
  const { MailRouteView } =
    await vi.importActual<typeof import('./lazy-route-views')>(
      './lazy-route-views'
    );
  const threadView = vi.fn(() => ({ EmailDetailRouteView: () => null }));
  vi.doMock('@app/features/email-view/route-views', () => ({
    MailRouteView: () => null,
  }));
  vi.doMock('@app/features/email-view/components/EmailDetailView', threadView);

  await MailRouteView.preload();

  await vi.waitFor(() => expect(threadView).toHaveBeenCalledOnce());
});
