// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionCard, type ConnectionCardProps } from './connection-card';

vi.mock('@ui', () => ({
  confirmDialog: vi.fn(),
  Button: (
    props: import('solid-js').JSX.ButtonHTMLAttributes<HTMLButtonElement>
  ) => <button {...props} />,
}));
afterEach(cleanup);
function props(): ConnectionCardProps {
  return {
    status: { enabled: true, connected: false, ephemeral: true },
    failed: false,
    code: '',
    busy: false,
    error: '',
    onCode: vi.fn(),
    onBegin: vi.fn(),
    onComplete: vi.fn(),
    onDisconnect: vi.fn(),
    onRefresh: vi.fn(),
  };
}
it('shows Claude before connection without adding setup details', () => {
  const value = props();
  render(() => <ConnectionCard {...value} />);
  expect(screen.getByText('Claude Cloud')).toBeTruthy();
  expect(screen.queryByText(/Macro never asks/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Connect Claude' }));
  expect(value.onBegin).toHaveBeenCalledOnce();
});
it('renders consent link and masked code entry without tokens', () => {
  const value = {
    ...props(),
    login: {
      attemptId: 'attempt',
      authorizationUrl: 'https://claude.com/consent',
      expiresIn: 600,
    },
    code: 'code#state',
  };
  render(() => <ConnectionCard {...value} />);
  expect(screen.getByText(/This connection is temporary/)).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('rel')).toBe(
    'noopener noreferrer'
  );
  expect(screen.getByLabelText(/Paste the complete/).getAttribute('type')).toBe(
    'password'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Finish connecting' }));
  expect(value.onComplete).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(value.onDisconnect).toHaveBeenCalledOnce();
});
it('shows disabled and failed states instead of silently disappearing', () => {
  render(() => (
    <ConnectionCard
      {...props()}
      status={{ enabled: false, connected: false, ephemeral: false }}
    />
  ));
  expect(
    screen.getByText(/sign-in is not configured on this deployment/)
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect Claude' })).toBeNull();
  cleanup();
  render(() => <ConnectionCard {...props()} status={undefined} failed />);
  expect(
    screen.getByRole('button', { name: 'Retry connection status' })
  ).toBeTruthy();
});
