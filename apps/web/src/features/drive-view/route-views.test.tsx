import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const [authenticated, setAuthenticated] = createSignal<boolean | undefined>();
const mountPrivateDrive = vi.fn();

vi.mock('@core/auth', () => ({
  useIsAuthenticated: () => authenticated,
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { content: () => ({ type: 'component', params: {} }) },
  }),
}));
vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ pageView: vi.fn(), track: vi.fn() }),
}));
vi.mock('./drive-view', () => ({
  DriveView: () => {
    mountPrivateDrive();
    return <div>My Files</div>;
  },
  SignedOutDriveView: () => <div>Shared document viewer</div>,
}));
vi.mock('./drive-view-skeleton', () => ({
  DriveViewSkeleton: () => <div>Confirming session</div>,
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading</div>,
}));
vi.mock('@app/lib/split-router', () => ({
  useSplitRouter: () => ({}),
  useRouteParams: () => ({}),
}));
vi.mock('@app/routes/routes', () => ({ driveCallRoute: {} }));
vi.mock('@block-call/call-route', () => ({ callDetailSearch: {} }));

// Keep the real withAuth gate; only the unrelated app analytics wrapper is stubbed.
vi.mock(
  '@components/app/split-layout/split-router/app-route-shell',
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import('@components/app/split-layout/split-router/app-route-shell')
      >();
    return {
      ...original,
      AppView: (props: ParentProps) => <>{props.children}</>,
    };
  }
);

import { DriveRouteView } from './route-views';

beforeEach(() => {
  setAuthenticated(undefined);
  mountPrivateDrive.mockClear();
});
afterEach(cleanup);

it('mounts shared details without mounting private Drive sources when signed out', () => {
  setAuthenticated(false);
  render(() => <DriveRouteView />);

  expect(screen.getByText('Shared document viewer')).toBeTruthy();
  expect(screen.queryByText('My Files')).toBeNull();
  expect(mountPrivateDrive).not.toHaveBeenCalled();
});

it('waits for the session before choosing a workspace', () => {
  render(() => <DriveRouteView />);

  expect(screen.getByText('Confirming session')).toBeTruthy();
  expect(screen.queryByText('Shared document viewer')).toBeNull();
  expect(mountPrivateDrive).not.toHaveBeenCalled();
  setAuthenticated(false);
  expect(screen.getByText('Shared document viewer')).toBeTruthy();
});

it('switches between shared details and private Drive as the session changes', () => {
  setAuthenticated(false);
  render(() => (
    <>
      <button onClick={() => setAuthenticated(true)}>Sign in</button>
      <button onClick={() => setAuthenticated(false)}>Sign out</button>
      <DriveRouteView />
    </>
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByText('My Files')).toBeTruthy();
  expect(screen.queryByText('Shared document viewer')).toBeNull();
  expect(mountPrivateDrive).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.getByText('Shared document viewer')).toBeTruthy();
  expect(screen.queryByText('My Files')).toBeNull();
});
