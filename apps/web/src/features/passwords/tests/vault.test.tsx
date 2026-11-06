import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type PasswordResult,
  PasswordsProvider,
} from '../context/passwords-context';
import type { PasswordItem, PasswordValues } from '../core/types';
import { createVault, type VaultController } from '../primitives/vault';
import { passwordKeys } from '../queries/keys';
import { createFakePasswordSource } from './fake-source';

afterEach(cleanup);

it('explicit lock discards an editor payload, pending save snapshot, and verification seed', () => {
  const source = createFakePasswordSource();
  let controller: VaultController | undefined;
  function Probe() {
    controller = createVault('fixture-team');
    return null;
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <PasswordsProvider
        value={{
          source,
          recipients: () => [],
          recipientsLoading: () => false,
          recipientsError: () => false,
          writeClipboard: async () => {},
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  controller.createItem();
  controller.setDraft({
    name: 'Account',
    kind: 'login',
    url: '',
    folderId: null,
    favorite: false,
    values: {
      username: 'private-account',
      password: 'private-value',
      notes: 'private-note',
      fields: [],
    },
  });
  controller.setTotpKey('JBSWY3DPEHPK3PXP');
  controller.setPendingSelection({ item: undefined });
  controller.lock();
  expect(controller.draft()).toBeUndefined();
  expect(controller.totpKey()).toBe('');
  expect(controller.values()).toBeUndefined();
  expect(controller.pendingSelection()).toBeUndefined();
});

it('discards a reveal that completes after the vault locks', async () => {
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
      values: {
        username: '',
        password: 'private-value',
        notes: '',
        fields: [],
      },
    },
    '019a0000-0000-7000-8000-000000000001'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  let resolveReveal:
    | ((
        value: Awaited<
          PasswordResult<{ values: PasswordValues; version: number }>
        >
      ) => void)
    | undefined;
  source.reveal = () =>
    new Promise((resolve) => {
      resolveReveal = resolve;
    });
  let controller: VaultController | undefined;
  function Probe() {
    controller = createVault('fixture-team');
    return null;
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <PasswordsProvider
        value={{
          source,
          recipients: () => [],
          recipientsLoading: () => false,
          recipientsError: () => false,
          writeClipboard: async () => {},
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  controller.select(saved.value);
  const pending = controller.reveal();
  controller.lock();
  if (!resolveReveal) throw new Error('Reveal was not requested');
  resolveReveal(
    ok({
      values: {
        username: '',
        password: 'private-value',
        notes: '',
        fields: [],
      },
      version: 1,
    })
  );
  await pending;
  expect(controller.values()).toBeUndefined();
});

it('does not copy a late response for a credential that is no longer selected', async () => {
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
      values: {
        username: '',
        password: 'private-value',
        notes: '',
        fields: [],
      },
    },
    '019a0000-0000-7000-8000-000000000002'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  let resolveCopy:
    | ((
        value: Awaited<
          PasswordResult<{ values: PasswordValues; version: number }>
        >
      ) => void)
    | undefined;
  source.copy = () =>
    new Promise((resolve) => {
      resolveCopy = resolve;
    });
  const clipboard = vi.fn(async () => {});
  let controller: VaultController | undefined;
  function Probe() {
    controller = createVault('fixture-team');
    return null;
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <PasswordsProvider
        value={{
          source,
          recipients: () => [],
          recipientsLoading: () => false,
          recipientsError: () => false,
          writeClipboard: clipboard,
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  controller.select(saved.value);
  const pending = controller.copy();
  controller.select(undefined);
  if (!resolveCopy) throw new Error('Copy was not requested');
  resolveCopy(
    ok({
      values: {
        username: '',
        password: 'private-value',
        notes: '',
        fields: [],
      },
      version: 1,
    })
  );
  await pending;
  expect(clipboard).not.toHaveBeenCalled();
});

it.each(['reveal', 'copy'] as const)(
  '%s refreshes Recently used without caching revealed values',
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
        values: {
          username: '',
          password: 'private-value',
          notes: '',
          fields: [],
        },
      },
      '019a0000-0000-7000-8000-000000000003'
    );
    if (saved.isErr()) throw new Error('Fixture save failed');
    let metadata = saved.value;
    source.list = async () => [metadata];
    source[action] = async () => {
      metadata = { ...metadata, lastUsedAt: '2026-11-06T21:00:00Z' };
      return ok({
        values: {
          username: '',
          password: 'private-value',
          notes: '',
          fields: [],
        },
        version: 1,
      });
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    queryClient.setQueryData(passwordKeys.items('fixture-team'), [metadata]);
    let controller: VaultController | undefined;
    function Probe() {
      controller = createVault('fixture-team');
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <PasswordsProvider
          value={{
            source,
            recipients: () => [],
            recipientsLoading: () => false,
            recipientsError: () => false,
            writeClipboard: async () => {},
          }}
        >
          <Probe />
        </PasswordsProvider>
      </QueryClientProvider>
    ));
    if (!controller) throw new Error('Fixture controller missing');
    controller.select(metadata);
    controller.setFilter('recent');
    expect(controller.visibleItems()).toEqual([]);
    await controller[action]();
    expect(controller.visibleItems().map((item) => item.id)).toEqual([
      metadata.id,
    ]);
    expect(controller.selected()?.lastUsedAt).toBe('2026-11-06T21:00:00Z');
    expect(
      JSON.stringify(
        queryClient.getQueryData(passwordKeys.items('fixture-team'))
      )
    ).not.toContain('private-value');
  }
);

it.each(['reveal', 'copy'] as const)(
  '%s metadata refresh preserves locking and a later selection',
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
        values: {
          username: '',
          password: 'private-value',
          notes: '',
          fields: [],
        },
      },
      '019a0000-0000-7000-8000-000000000004'
    );
    if (saved.isErr()) throw new Error('Fixture save failed');
    let resolveList: ((metadata: PasswordItem[]) => void) | undefined;
    let readStarted: (() => void) | undefined;
    const refreshing = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    source.list = () =>
      new Promise((resolve) => {
        resolveList = resolve;
        readStarted?.();
      });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity } },
    });
    const other = {
      ...saved.value,
      id: '019a0000-0000-7000-8000-000000000005',
    };
    queryClient.setQueryData(passwordKeys.items('fixture-team'), [
      saved.value,
      other,
    ]);
    let controller: VaultController | undefined;
    function Probe() {
      controller = createVault('fixture-team');
      return null;
    }
    render(() => (
      <QueryClientProvider client={queryClient}>
        <PasswordsProvider
          value={{
            source,
            recipients: () => [],
            recipientsLoading: () => false,
            recipientsError: () => false,
            writeClipboard: async () => {},
          }}
        >
          <Probe />
        </PasswordsProvider>
      </QueryClientProvider>
    ));
    if (!controller) throw new Error('Fixture controller missing');
    controller.select(saved.value);
    const pending = controller[action]();
    await refreshing;
    controller.lock();
    controller.select(other);
    if (!resolveList) throw new Error('Metadata refresh was not requested');
    resolveList([
      { ...saved.value, lastUsedAt: '2026-11-06T21:00:00Z' },
      other,
    ]);
    await pending;
    expect(controller.values()).toBeUndefined();
    expect(controller.copied()).toBe(false);
    expect(controller.selected()?.id).toBe(other.id);
    expect(controller.selected()?.lastUsedAt).toBeNull();
    expect(
      JSON.stringify(
        queryClient.getQueryData(passwordKeys.items('fixture-team'))
      )
    ).not.toContain('private-value');
  }
);
