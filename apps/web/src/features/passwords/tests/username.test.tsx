import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type PasswordResult,
  PasswordsProvider,
} from '../context/passwords-context';
import { createVault, type VaultController } from '../primitives/vault';
import { createFakePasswordSource } from './fake-source';
import { FIXTURE_SCOPE } from './fixture-scope';

afterEach(cleanup);

it('loads and copies only the username without disclosing or caching the password bundle', async () => {
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
        notes: 'protected-note',
        fields: [],
      },
    },
    '019a0000-0000-7000-8000-000000000006'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  const identifier = Promise.resolve(
    ok({ username: 'account-identifier', version: 1 })
  );
  source.username = vi.fn(() => identifier);
  source.copyUsername = vi.fn(async () =>
    ok({ username: 'account-identifier', version: 1 })
  );
  const reveal = vi.spyOn(source, 'reveal');
  const copy = vi.spyOn(source, 'copy');
  const clipboard = vi.fn(async (_value: string) => {});
  const queryClient = new QueryClient();
  let controller: VaultController | undefined;
  function Probe() {
    controller = createVault();
    return null;
  }
  render(() => (
    <QueryClientProvider client={queryClient}>
      <PasswordsProvider
        value={{
          scope: FIXTURE_SCOPE,
          source,
          recipients: () => [],
          recipientsLoading: () => false,
          recipientsError: () => false,
          writeClipboard: clipboard,
          displayName: (accountId) => accountId.replace(/^macro\|/, ''),
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  await waitFor(() => expect(controller?.loadedItems()).toHaveLength(1));
  controller.select(saved.value);
  await identifier;
  expect(controller.username()).toBe('account-identifier');
  expect(controller.usernameLoading()).toBe(false);
  expect(controller.values()).toBeUndefined();
  await controller.copyUsername();
  expect(clipboard).toHaveBeenCalledExactlyOnceWith('account-identifier');
  expect(source.copyUsername).toHaveBeenCalledExactlyOnceWith(saved.value.id);
  expect(reveal).not.toHaveBeenCalled();
  expect(copy).not.toHaveBeenCalled();
  expect(controller.values()).toBeUndefined();
  const cached = JSON.stringify(
    queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data)
  );
  expect(cached).not.toContain('account-identifier');
  expect(cached).not.toContain('protected-password');
  expect(cached).not.toContain('protected-note');
});

it.each(['username', 'copyUsername'] as const)(
  'ignores a late %s response after the selected item changes',
  async (action) => {
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
          username: 'old-identifier',
          password: 'protected-password',
          notes: '',
          fields: [],
        },
      },
      '019a0000-0000-7000-8000-000000000007'
    );
    if (saved.isErr()) throw new Error('Fixture save failed');
    let finish:
      | ((
          result: Awaited<PasswordResult<{ username: string; version: number }>>
        ) => void)
      | undefined;
    const identifier = new Promise<
      Awaited<PasswordResult<{ username: string; version: number }>>
    >((resolve) => {
      finish = resolve;
    });
    source[action] = () => identifier;
    const clipboard = vi.fn(async () => {});
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
            writeClipboard: clipboard,
            displayName: (accountId) => accountId.replace(/^macro\|/, ''),
          }}
        >
          <Probe />
        </PasswordsProvider>
      </QueryClientProvider>
    ));
    if (!controller) throw new Error('Fixture controller missing');
    await waitFor(() => expect(controller?.loadedItems()).toHaveLength(1));
    controller.select(saved.value);
    const pending =
      action === 'copyUsername' ? controller.copyUsername() : identifier;
    controller.select(undefined);
    if (!finish) throw new Error('Username request missing');
    finish(ok({ username: 'old-identifier', version: 1 }));
    await pending;
    expect(controller.selected()).toBeUndefined();
    expect(controller.username()).toBeUndefined();
    expect(controller.usernameLoading()).toBe(false);
    expect(controller.values()).toBeUndefined();
    expect(clipboard).not.toHaveBeenCalled();
  }
);
