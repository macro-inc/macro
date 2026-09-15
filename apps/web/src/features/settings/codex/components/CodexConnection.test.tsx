import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { CodexConnection } from './CodexConnection';

vi.mock('@ui', () => ({
  Button: (
    props: import('solid-js').JSX.ButtonHTMLAttributes<HTMLButtonElement>
  ) => <button {...props} />,
}));
const base = () => ({
  connection: undefined,
  login: undefined,
  environments: [],
  environmentsLoading: false,
  environmentsError: false,
  loading: false,
  pending: false,
  error: undefined,
  onConnect: vi.fn(),
  onCancel: vi.fn(),
  onDisconnect: vi.fn(),
  onRetryEnvironments: vi.fn(),
  onSave: vi.fn(),
});
const login = {
  userCode: 'ABCD-EFGH',
  verificationUrl: 'https://auth.openai.com/codex/device',
  expiresAt: '2026-09-16T12:00:00Z',
};

describe('Codex connection', () => {
  it('identifies a connection by account when email is unavailable', () => {
    render(() => (
      <CodexConnection
        {...base()}
        connection={{
          connected: true,
          email: null,
          accountId: 'example-account',
          environmentId: null,
          branch: 'main',
        }}
      />
    ));
    expect(screen.getByText('example-account')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Codex' })).toBeTruthy();
  });

  it('starts device sign-in without requesting a token', () => {
    const props = base();
    render(() => <CodexConnection {...props} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect with ChatGPT' })
    );
    expect(props.onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('shows the code, official link and cancel while waiting', () => {
    const props = base();
    render(() => (
      <CodexConnection {...props} login={{ ...login, status: 'pending' }} />
    ));
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Continue to ChatGPT' })
        .getAttribute('href')
    ).toBe(login.verificationUrl);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel sign-in' }));
    expect(props.onCancel).toHaveBeenCalledOnce();
  });
  it.each(['expired', 'failed'] as const)(
    'allows a fresh login after %s',
    (status) => {
      render(() => (
        <CodexConnection {...base()} login={{ ...login, status }} />
      ));
      expect(
        screen.getByRole('button', { name: 'Connect with ChatGPT' })
      ).toBeTruthy();
      expect(
        screen.queryByRole('link', { name: 'Continue to ChatGPT' })
      ).toBeNull();
    }
  );
  it('saves the selected environment and trimmed branch and permits disconnect', () => {
    const props = base();
    render(() => (
      <CodexConnection
        {...props}
        connection={{
          connected: true,
          email: null,
          environmentId: null,
          branch: 'main',
        }}
        environments={[{ id: 'env-1', label: 'Example repo' }]}
      />
    ));
    expect(
      screen
        .getByRole('button', { name: 'Save Codex settings' })
        .hasAttribute('disabled')
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Cloud environment'), {
      target: { value: 'env-1' },
    });
    fireEvent.input(screen.getByLabelText('Branch'), {
      target: { value: ' feature/test ' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Codex settings' })
    );
    expect(props.onSave).toHaveBeenCalledWith({
      environmentId: 'env-1',
      branch: 'feature/test',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect ChatGPT' }));
    expect(props.onDisconnect).toHaveBeenCalledOnce();
  });
  it('keeps server errors visible and prevents duplicate pending actions', () => {
    render(() => (
      <CodexConnection {...base()} error="Could not start sign-in" pending />
    ));
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not start sign-in'
    );
    expect(
      screen
        .getByRole('button', { name: 'Connect with ChatGPT' })
        .hasAttribute('disabled')
    ).toBe(true);
  });
});
