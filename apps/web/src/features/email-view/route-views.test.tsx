import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MailRouteView } from './route-views';

const pane = vi.hoisted(() => ({
  width: (): number => 1000,
  replace: vi.fn(),
}));

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));
vi.mock('@core/component/LoadingBlock', () => ({ LoadingBlock: () => null }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: () => {}, track: () => {} }),
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  useParams: () => ({ threadId: 'thread-1' }),
  createSearchParams: () => [{}],
  useSplitRouter: () => ({ entry: () => undefined }),
}));
vi.mock('@components/app/split-layout/context', async () => {
  const { createContext } = await import('solid-js');
  return {
    SplitPanelContext: createContext({
      panelSize: {
        get width() {
          return pane.width();
        },
      },
    }),
  };
});
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { id: 'mail', replace: pane.replace },
  }),
}));
vi.mock('@components/app/split-layout/view-restoration', () => ({
  useViewRestoration: () => {},
}));
vi.mock('./email-view', () => ({
  EmailView: () => <textarea aria-label="Reply draft" />,
}));
vi.mock('./email-view-skeleton', () => ({ EmailViewSkeleton: () => null }));

afterEach(cleanup);

it('keeps a selected Mail route hosted when the touch pane folds', () => {
  const [width, setWidth] = createSignal(1000);
  pane.width = width;
  render(() => <MailRouteView />);
  const draft = screen.getByRole('textbox', { name: 'Reply draft' });

  setWidth(390);

  expect(screen.getByRole('textbox', { name: 'Reply draft' })).toBe(draft);
  expect(pane.replace).not.toHaveBeenCalled();
});
