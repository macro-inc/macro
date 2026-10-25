import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const [active, setActive] = createSignal<{ value: string }>();
const navigate = vi.fn();
const openDocument = vi.fn();

vi.mock('@app/components/view-shell', () => {
  const Slot = (props: ParentProps) => props.children;
  return {
    ViewBreadcrumbs: { Root: Slot },
    ViewShell: { Root: Slot, Main: Slot },
  };
});
vi.mock('@components/app/split-panel', () => {
  const Slot = (props: ParentProps) => props.children;
  return { SplitPanel: { Root: Slot, Body: Slot } };
});
vi.mock('@app/lib/split-router', () => ({
  SplitRouter: {
    Outlet: () => {
      openDocument();
      return <div>Shared document</div>;
    },
  },
}));
vi.mock('../drive-detail-navigation', () => ({
  useDriveDetailNavigation: () => ({ active, popTo: vi.fn() }),
}));
vi.mock('./drive-workspace', () => ({
  DriveLoading: () => <div>Loading files</div>,
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading files</div>,
}));
vi.mock('@solidjs/router', () => ({ useNavigate: () => navigate }));
vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => false }));

import { SignedOutDriveWorkspace } from './signed-out-drive-workspace';

afterEach(() => {
  cleanup();
  setActive(undefined);
  vi.clearAllMocks();
});

it('offers sign-in instead of loading a list without an active document', () => {
  render(() => <SignedOutDriveWorkspace />);
  expect(screen.getByText('Sign in to view your files')).toBeTruthy();
  expect(screen.queryByText('Loading files')).toBeNull();
  expect(openDocument).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Login' }));
  expect(navigate).toHaveBeenCalledWith('/login');
});

it('keeps public details available and shows sign-in when the detail is closed', () => {
  setActive({ value: 'document' });
  render(() => (
    <>
      <button onClick={() => setActive(undefined)}>Close document</button>
      <SignedOutDriveWorkspace />
    </>
  ));
  expect(screen.getByText('Shared document')).toBeTruthy();
  expect(screen.queryByText('Sign in to view your files')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close document' }));
  expect(screen.getByText('Sign in to view your files')).toBeTruthy();
  expect(screen.queryByText('Shared document')).toBeNull();
  expect(openDocument).toHaveBeenCalledOnce();
});
