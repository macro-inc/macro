import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CodexConnection } from './CodexConnection';

beforeAll(() => vi.stubGlobal('scrollTo', vi.fn()));
const base = () => ({
  open: true,
  onOpen: vi.fn(),
  onClose: vi.fn(),
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
        }}
      />
    ));
    expect(screen.getByText('example-account')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Codex' })).toBeTruthy();
  });

  it('cannot save without selecting an environment when environment loading fails', () => {
    const props = base();
    render(() => (
      <CodexConnection
        {...props}
        connection={{
          connected: true,
          environmentId: 'env-old',
        }}
        environmentsError
      />
    ));
    fireEvent.change(screen.getByLabelText('Cloud environment'), {
      target: { value: '' },
    });
    expect(screen.queryByLabelText('Branch')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(
      'Could not load environments.'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Codex settings' })
    );
    expect(props.onSave).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: 'Save Codex settings' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it('requires an environment and offers no automatic or branch selection', () => {
    render(() => (
      <CodexConnection
        {...base()}
        connection={{ connected: true, environmentId: null }}
        environmentsLoading
      />
    ));
    expect(screen.getByRole('status').textContent).toBe(
      'Loading environments…'
    );
    expect(screen.queryByLabelText('Branch')).toBeNull();
    expect(
      screen.getByRole('option', { name: 'Choose an environment' })
    ).toBeTruthy();
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
  it('saves only the selected environment and always describes the main branch', () => {
    const props = base();
    render(() => (
      <CodexConnection
        {...props}
        connection={{
          connected: true,
          email: null,
          environmentId: null,
        }}
        environments={[
          {
            id: 'env-1',
            label: 'Example repo',
            repositories: [
              {
                fullName: 'example/repo',
                cloneUrl: 'https://github.com/example/repo.git',
                defaultBranch: 'develop',
              },
            ],
          },
        ]}
      />
    ));
    expect(
      screen
        .getByRole('button', { name: 'Save Codex settings' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(screen.queryByLabelText('Branch')).toBeNull();
    fireEvent.change(screen.getByLabelText('Cloud environment'), {
      target: { value: 'env-1' },
    });
    expect(screen.queryByLabelText('Branch')).toBeNull();
    expect(
      screen.getByText(/New sessions always start from the main branch/)
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Codex settings' })
    );
    expect(props.onSave).toHaveBeenCalledWith({
      environmentId: 'env-1',
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

  it('opens configuration from the runtime row without starting sign-in', () => {
    const props = base();
    const [open, setOpen] = createSignal(false);
    render(() => (
      <CodexConnection
        {...props}
        open={open()}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        connection={{ connected: true, environmentId: 'env-1' }}
        login={{ ...login, status: 'connected' }}
      />
    ));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    expect(screen.getByRole('dialog', { name: 'Codex' })).toBeTruthy();
    expect(screen.getByLabelText('Cloud environment')).toBeTruthy();
    expect(props.onConnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('continues first sign-in through required environment setup after the account remounts', () => {
    const props = base();
    const [connection, setConnection] = createSignal({
      connected: false,
      accountId: null as string | null,
      environmentId: null as string | null,
    });
    const [open, setOpen] = createSignal(true);
    const [loginStatus, setLoginStatus] = createSignal<'pending' | 'connected'>(
      'pending'
    );
    render(() => (
      <Show when={connection().accountId ?? 'disconnected'} keyed>
        {(_account) => (
          <CodexConnection
            {...props}
            open={open()}
            onClose={() => setOpen(false)}
            connection={connection()}
            login={{ ...login, status: loginStatus() }}
            environments={[
              { id: 'env-1', label: 'My project', repositories: [] },
            ]}
          />
        )}
      </Show>
    ));
    expect(screen.getByText('ABCD-EFGH')).toBeTruthy();
    setLoginStatus('connected');
    setConnection({
      connected: true,
      accountId: 'new-account',
      environmentId: null,
    });
    expect(screen.queryByText('ABCD-EFGH')).toBeNull();
    expect(screen.getByText('Setup required')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    const environment = screen.getByLabelText('Cloud environment');
    expect(
      screen.getByRole('button', { name: 'Save Codex settings' })
    ).toHaveProperty('disabled', true);
    fireEvent.change(environment, { target: { value: 'env-1' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Codex settings' })
    );
    expect(props.onSave).toHaveBeenCalledWith({ environmentId: 'env-1' });
    expect(screen.getByText('Setup required')).toBeTruthy();
    setConnection({
      connected: true,
      accountId: 'new-account',
      environmentId: 'env-1',
    });
    expect(screen.queryByText('Setup required')).toBeNull();
    expect(screen.getByText('Connected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByLabelText('Cloud environment')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Configure Codex' })
    ).toBeTruthy();
  });

  it('keeps an unsaved environment selection when its modal is closed and reopened', () => {
    const props = base();
    const [open, setOpen] = createSignal(true);
    render(() => (
      <CodexConnection
        {...props}
        open={open()}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        connection={{ connected: true, environmentId: 'env-1' }}
        environments={[
          { id: 'env-1', repositories: [] },
          { id: 'env-2', repositories: [] },
        ]}
      />
    ));
    fireEvent.change(screen.getByLabelText('Cloud environment'), {
      target: { value: 'env-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(props.onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Configure Codex' }));
    expect(screen.getByLabelText('Cloud environment')).toHaveProperty(
      'value',
      'env-2'
    );
    expect(screen.getByRole('status').textContent).toContain('Unsaved changes');
  });

  it('marks selections unsaved until the server confirms them and preserves failed edits', () => {
    const props = base();
    const [connection, setConnection] = createSignal({
      connected: true,
      environmentId: null as string | null,
    });
    const [error, setError] = createSignal<string>();
    render(() => (
      <CodexConnection
        {...props}
        connection={connection()}
        error={error()}
        environments={[
          {
            id: 'env-1',
            repositories: [
              {
                fullName: 'example/repo',
                cloneUrl: 'https://github.com/example/repo.git',
                defaultBranch: 'main',
              },
            ],
          },
        ]}
      />
    ));
    const save = screen.getByRole('button', { name: 'Save Codex settings' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('Cloud environment'), {
      target: { value: 'env-1' },
    });
    expect(screen.getByRole('status').textContent).toContain('Unsaved changes');
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    setError('Could not save Codex settings.');
    expect(screen.getByRole('status').textContent).toContain('Unsaved changes');
    expect(save.hasAttribute('disabled')).toBe(false);
    expect(
      (screen.getByLabelText('Cloud environment') as HTMLSelectElement).value
    ).toBe('env-1');
    setError(undefined);
    setConnection({ connected: true, environmentId: 'env-1' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(save.hasAttribute('disabled')).toBe(true);
  });
});
