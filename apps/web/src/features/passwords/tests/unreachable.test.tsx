import { ThrownResultError } from '@core/util/result';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { FailureNotice } from '../components/failure-notice';
import { ItemDetailBody } from '../components/item-detail';
import { PasswordsProvider } from '../context/passwords-context';
import type { PasswordItem } from '../core/types';
import { createVault, type VaultController } from '../primitives/vault';
import { createFakePasswordSource } from './fake-source';
import { FIXTURE_SCOPE, noImport } from './fixture-scope';

afterEach(cleanup);

const UNREACHABLE = "Can't reach Macro. Check your connection.";
const SERVICE_UNAVAILABLE =
  'Passwords is temporarily unavailable. Try again in a minute.';

it('marks the vault unreachable when a username read gets no answer, and recovers on reselect', async () => {
  const source = createFakePasswordSource();
  const saved = await source.save(
    undefined,
    undefined,
    {
      name: 'Account',
      kind: 'login',
      url: '',
      folderId: null,
      favorite: false,
      private: false,
      values: {
        username: 'account-identifier',
        password: 'protected-password',
        notes: '',
        fields: [],
      },
    },
    '019a0000-0000-7000-8000-000000000031'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  source.username = vi
    .fn()
    .mockResolvedValueOnce(err('unreachable'))
    .mockResolvedValueOnce(ok({ username: 'account-identifier', version: 1 }));
  let controller: VaultController | undefined;
  function Probe() {
    controller = createVault();
    return null;
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <PasswordsProvider
        value={{
          scope: FIXTURE_SCOPE,
          source,
          recipients: () => [],
          recipientsLoading: () => false,
          recipientsError: () => false,
          writeClipboard: vi.fn(async () => {}),
          displayName: (accountId) => accountId,
          ...noImport(),
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  await waitFor(() => expect(controller?.loadedItems()).toHaveLength(1));
  controller.select(saved.value);
  await waitFor(() => expect(controller?.failure()).toBe('unreachable'));
  expect(controller.connectionProblem()).toBe('unreachable');
  expect(controller.username()).toBeUndefined();

  controller.select(saved.value);
  await waitFor(() =>
    expect(controller?.username()).toBe('account-identifier')
  );
  expect(controller.failure()).toBeUndefined();
  expect(controller.connectionProblem()).toBeUndefined();
});

it('names the missing connection on the username row instead of calling the username unavailable', () => {
  const item: PasswordItem = {
    id: '019a0000-0000-7000-8000-000000000032',
    teamId: '019a0000-0000-7000-8000-000000000033',
    name: 'Account',
    kind: 'login',
    url: null,
    folderId: null,
    favorite: false,
    version: 1,
    hasTotp: false,
    shared: false,
    shareCount: 0,
    sharedWithTeam: true,
    canManage: true,
    canEdit: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
  };
  render(() => (
    <ItemDetailBody
      item={item}
      state={{
        username: undefined,
        usernameLoading: false,
        usernameCopied: false,
        values: undefined,
        copied: false,
        code: undefined,
        codeFailed: false,
        failure: 'unreachable',
        history: [],
        activity: [],
        now: Date.parse('2026-01-02T00:00:00Z'),
      }}
      actions={{
        reveal: vi.fn(),
        conceal: vi.fn(),
        copyPassword: vi.fn(),
        copyUsername: vi.fn(),
        copyValue: vi.fn(async () => true),
        loadCode: vi.fn(),
        setTotp: vi.fn(async () => true),
        loadHistory: vi.fn(),
      }}
    />
  ));
  expect(screen.getByText(UNREACHABLE)).toBeTruthy();
  expect(screen.queryByText('Username unavailable')).toBeNull();
});

it.each([
  ['unreachable', UNREACHABLE],
  ['failed', 'Could not complete this action. Please try again.'],
  [
    'folderMissing',
    'That folder was deleted. The item is now in All items; save again.',
  ],
  ['serviceUnavailable', SERVICE_UNAVAILABLE],
] as const)('shows the %s failure as its own alert', (failure, text) => {
  render(() => <FailureNotice failure={failure} />);
  expect(screen.getByRole('alert').textContent).toBe(text);
});

it('shows nothing without a failure', () => {
  render(() => <FailureNotice failure={undefined} />);
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each([
  ['NETWORK_ERROR', 'unreachable'],
  ['SERVICE_UNAVAILABLE', 'serviceUnavailable'],
] as const)(
  'marks the list stale when its reload fails with %s',
  async (code, problem) => {
    const source = createFakePasswordSource();
    source.list = vi
      .fn()
      .mockRejectedValueOnce(new ThrownResultError([{ code, message: code }]));
    let controller: VaultController | undefined;
    function Probe() {
      controller = createVault();
      return null;
    }
    render(() => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <PasswordsProvider
          value={{
            scope: FIXTURE_SCOPE,
            source,
            recipients: () => [],
            recipientsLoading: () => false,
            recipientsError: () => false,
            writeClipboard: vi.fn(async () => {}),
            displayName: (accountId) => accountId,
            ...noImport(),
          }}
        >
          <Probe />
        </PasswordsProvider>
      </QueryClientProvider>
    ));
    await waitFor(() => expect(controller?.connectionProblem()).toBe(problem));
  }
);

it('names an unavailable service on the username row', () => {
  render(() => (
    <ItemDetailBody
      item={{
        id: '019a0000-0000-7000-8000-000000000034',
        teamId: '019a0000-0000-7000-8000-000000000033',
        name: 'Account',
        kind: 'login',
        url: null,
        folderId: null,
        favorite: false,
        version: 1,
        hasTotp: false,
        shared: false,
        shareCount: 0,
        sharedWithTeam: true,
        canManage: true,
        canEdit: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        lastUsedAt: null,
      }}
      state={{
        username: undefined,
        usernameLoading: false,
        usernameCopied: false,
        values: undefined,
        copied: false,
        code: undefined,
        codeFailed: false,
        failure: 'serviceUnavailable',
        history: [],
        activity: [],
        now: Date.parse('2026-01-02T00:00:00Z'),
      }}
      actions={{
        reveal: vi.fn(),
        conceal: vi.fn(),
        copyPassword: vi.fn(),
        copyUsername: vi.fn(),
        copyValue: vi.fn(async () => true),
        loadCode: vi.fn(),
        setTotp: vi.fn(async () => true),
        loadHistory: vi.fn(),
      }}
    />
  ));
  expect(screen.getByText(SERVICE_UNAVAILABLE)).toBeTruthy();
});
