/** @vitest-environment jsdom */
import { EditorEngineProvider } from '@core/document-session/editor-engine';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { withMeetingShell } from './shells';

const mocks = await vi.hoisted(async () => {
  const { createSignal } = await import('solid-js');
  const [authenticated, setAuthenticated] = createSignal(false);
  return {
    authenticated,
    setAuthenticated,
    sync: vi.fn((_userId: () => string | undefined) => {}),
  };
});

vi.mock('@core/auth', () => ({
  useIsAuthenticated: () => mocks.authenticated,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'member' }));
vi.mock('@queries/messages/meeting-sync', () => ({
  useMeetingMessageSync: mocks.sync,
}));
vi.mock('@components/app/boot-shell', () => ({ dismissBootShell: () => {} }));
vi.mock('@components/app/Layout', () => ({
  PageContent: (props: { children: unknown }) => props.children,
}));
vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  ImperativeDialogHost: () => null,
}));
vi.mock('@core/document-session/engine-selection', () => ({
  RUST_EDITOR_ENGINE: true,
}));
// The native module is still downloading for the whole test.
vi.mock('@core/document-session/load', () => ({
  loadDocumentSession: () => new Promise(() => {}),
}));
vi.mock('@components/app/tab-layout/DesktopTabsController', () => ({
  DesktopTabsController: () => null,
  NO_SPLITS_TAB_HOST: {},
}));

afterEach(() => {
  cleanup();
  mocks.setAuthenticated(false);
  mocks.sync.mockClear();
});

it('starts meeting message sync only after account authentication', () => {
  const Meeting = withMeetingShell(() => <div>Meeting</div>);
  render(() => <Meeting />);
  expect(screen.getByText('Meeting')).toBeTruthy();
  expect(mocks.sync).not.toHaveBeenCalled();

  mocks.setAuthenticated(true);
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(mocks.sync.mock.calls[0][0]()).toBe('member');

  mocks.setAuthenticated(false);
  mocks.setAuthenticated(true);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

it('renders a page without an editor while the native engine loads', () => {
  const MeetingShell = withMeetingShell(() => <p>Call controls</p>);
  render(() => (
    <EditorEngineProvider>
      <MeetingShell />
    </EditorEngineProvider>
  ));

  expect(screen.getByText('Call controls')).toBeTruthy();
});
