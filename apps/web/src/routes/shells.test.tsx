/** @vitest-environment jsdom */
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
vi.mock('@ui', () => ({ ImperativeDialogHost: () => null }));

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
