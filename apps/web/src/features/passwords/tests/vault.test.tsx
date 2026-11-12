import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  type PasswordResult,
  type PasswordSource,
  PasswordsProvider,
} from '../context/passwords-context';
import { CHARACTER_CLASSES, generatePassword } from '../core/generator';
import type {
  PasswordDraft,
  PasswordItem,
  PasswordValues,
} from '../core/types';
import { createVault, type VaultController } from '../primitives/vault';
import { passwordKeys } from '../queries/keys';
import { createFakePasswordSource } from './fake-source';
import { createFixtureScope, FIXTURE_SCOPE } from './fixture-scope';

afterEach(cleanup);

function mountVault(source: PasswordSource, clipboard = async () => {}) {
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
          writeClipboard: clipboard,
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  return controller;
}

const LOGIN: PasswordDraft = {
  name: 'Account',
  kind: 'login',
  url: '',
  folderId: null,
  favorite: false,
  private: false,
  values: {
    username: 'private-account',
    password: 'private-value',
    notes: 'private-note',
    fields: [],
  },
};

it('locking, window blur and hiding the tab conceal values but never drop typed drafts', async () => {
  const source = createFakePasswordSource();
  const saved = await source.save(
    undefined,
    undefined,
    LOGIN,
    '019a0000-0000-7000-8000-000000000010'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  const vault = mountVault(source);
  await waitFor(() => expect(vault.loadedItems()).toHaveLength(1));
  const key = vault.createItem('login', null);
  vault.updateDraft(key, { ...LOGIN, name: 'Typed but unsaved' });
  vault.setDraftTotpKey(key, 'JBSWY3DPEHPK3PXP');

  vault.select(saved.value);
  await vault.reveal();
  expect(vault.values()?.password).toBe('private-value');
  vault.lock();
  expect(vault.values()).toBeUndefined();

  await vault.reveal();
  window.dispatchEvent(new Event('blur'));
  expect(vault.values()).toBeUndefined();

  await vault.reveal();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => true,
  });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => false,
  });
  expect(vault.values()).toBeUndefined();

  expect(vault.draft(key)?.draft.name).toBe('Typed but unsaved');
  expect(vault.draft(key)?.totpKey).toBe('JBSWY3DPEHPK3PXP');
  expect(vault.dirty()).toBe(true);
});

it('keeps every draft while selecting away and starting other kinds, and discards only on request', async () => {
  const source = createFakePasswordSource();
  const saved = await source.save(
    undefined,
    undefined,
    LOGIN,
    '019a0000-0000-7000-8000-000000000011'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  const vault = mountVault(source);
  await waitFor(() => expect(vault.loadedItems()).toHaveLength(1));
  const login = vault.createItem('login', null);
  vault.updateDraft(login, { ...LOGIN, name: 'First draft' });
  const card = vault.createItem('card', null);
  expect(
    vault.draft(card)?.draft.values.fields.map((field) => field.label)
  ).toEqual(['Expires', 'Security code']);
  vault.select(saved.value);
  vault.selectDraft(login);

  expect(vault.draft(login)?.draft.name).toBe('First draft');
  expect(vault.drafts().map((entry) => entry.key)).toEqual([card, login]);

  vault.discard(card);
  expect(vault.draft(card)).toBeUndefined();
  expect(vault.draft(login)?.draft.name).toBe('First draft');
  expect(vault.selection()).toEqual({ kind: 'draft', key: login });
});

it('requires a seed for a verification code and retries only the enrollment after it fails', async () => {
  const source = createFakePasswordSource();
  const save = vi.spyOn(source, 'save');
  let enrollments = 0;
  const setTotp = source.setTotp;
  source.setTotp = async (id, key) => {
    enrollments++;
    if (enrollments === 1) return err('failed');
    return setTotp(id, key);
  };
  const vault = mountVault(source);
  await waitFor(() => expect(vault.items.isPending).toBe(false));
  const key = vault.createItem('verification_code', null);
  vault.updateDraft(key, {
    ...LOGIN,
    kind: 'verification_code',
    name: 'Registrar',
    values: { ...LOGIN.values, password: '' },
  });

  await vault.save(key);
  expect(vault.draft(key)?.validation).toBe('totp');
  expect(save).not.toHaveBeenCalled();

  vault.setDraftTotpKey(key, 'JBSWY3DPEHPK3PXP');
  await vault.save(key);
  expect(save).toHaveBeenCalledTimes(1);
  expect(vault.draft(key)?.failure).toBe('totp');
  expect(vault.draft(key)?.itemId).toBeDefined();

  await vault.save(key);
  expect(save).toHaveBeenCalledTimes(1);
  expect(enrollments).toBe(2);
  expect(vault.draft(key)).toBeUndefined();
  await waitFor(() => expect(vault.selected()?.hasTotp).toBe(true));
});

it('creates, renames, nests and deletes folders, unfiling items without deleting them', async () => {
  const source = createFakePasswordSource();
  const vault = mountVault(source);
  await waitFor(() => expect(vault.folders.isPending).toBe(false));
  const parent = await vault.createFolder('Engineering', null);
  if (!parent) throw new Error('Folder was not created');
  const child = await vault.createFolder('Production', parent.id);
  if (!child) throw new Error('Subfolder was not created');
  expect(await vault.renameFolder(child.id, 'Prod')).toBe(true);
  const saved = await source.save(
    undefined,
    undefined,
    { ...LOGIN, folderId: child.id },
    '019a0000-0000-7000-8000-000000000012'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  await vault.items.refetch();
  vault.setFilter(`folder:${parent.id}`);
  expect(vault.visibleItems().map((item) => item.id)).toEqual([saved.value.id]);
  const draft = vault.createItem('login', child.id);

  expect(await vault.moveFolder(parent.id, child.id)).toBe(false);
  expect(await vault.deleteFolder(parent.id)).toBe(true);

  expect(vault.loadedFolders()).toEqual([]);
  expect(vault.filter()).toBe('all');
  expect(vault.loadedItems().map((item) => [item.id, item.folderId])).toEqual([
    [saved.value.id, null],
  ]);
  expect(vault.draft(draft)?.draft.folderId).toBeNull();
});

it('generates uniformly over the selected classes and always includes each one', () => {
  for (const classes of [
    ['uppercase', 'lowercase', 'digits', 'symbols'],
    ['digits', 'symbols'],
    ['lowercase'],
  ] as const) {
    for (let run = 0; run < 50; run++) {
      const value = generatePassword(12, classes);
      expect(value).toHaveLength(12);
      for (const name of classes)
        expect(
          [...value].some((character) =>
            CHARACTER_CLASSES[name].includes(character)
          )
        ).toBe(true);
      const allowed = classes.map((name) => CHARACTER_CLASSES[name]).join('');
      expect([...value].every((character) => allowed.includes(character))).toBe(
        true
      );
    }
  }
  expect(() => generatePassword(12, [])).toThrow();
  expect(() => generatePassword(11, ['digits'])).toThrow();
  expect(() => generatePassword(129, ['digits'])).toThrow();
});

it('draws characters without modulo bias by rejecting values above the largest multiple', () => {
  const values = [
    0xffffffff, 0xfffffffe, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22,
  ];
  const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation(((
    array: ArrayBufferView
  ) => {
    if (array instanceof Uint32Array) array.set(values.slice(0, array.length));
    return array;
  }) as typeof crypto.getRandomValues);
  // 11 symbols: 2^32 % 11 = 4, so values from 0xfffffffc up would favor the
  // first four symbols and must be skipped, not reduced.
  const value = generatePassword(12, ['symbols']);
  spy.mockRestore();
  const symbols = CHARACTER_CLASSES.symbols;
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    .map((entry) => symbols[entry % symbols.length])
    .join('');
  expect(value).toBe(expected);
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
      private: false,
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
          writeClipboard: async () => {},
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  await waitFor(() => expect(controller?.loadedItems()).toHaveLength(1));
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
      private: false,
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
        }}
      >
        <Probe />
      </PasswordsProvider>
    </QueryClientProvider>
  ));
  if (!controller) throw new Error('Fixture controller missing');
  await waitFor(() => expect(controller?.loadedItems()).toHaveLength(1));
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
        private: false,
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
    queryClient.setQueryData(passwordKeys.items(FIXTURE_SCOPE.key).queryKey, [
      metadata,
    ]);
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
        queryClient.getQueryData(passwordKeys.items(FIXTURE_SCOPE.key).queryKey)
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
        private: false,
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
    queryClient.setQueryData(passwordKeys.items(FIXTURE_SCOPE.key).queryKey, [
      saved.value,
      other,
    ]);
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
        queryClient.getQueryData(passwordKeys.items(FIXTURE_SCOPE.key).queryKey)
      )
    ).not.toContain('private-value');
  }
);

it('drops a reveal, copy and clipboard write that finish after the viewer changes', async () => {
  const source = createFakePasswordSource();
  const saved = await source.save(
    undefined,
    undefined,
    LOGIN,
    '019a0000-0000-7000-8000-000000000020'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  const reveals: ((
    value: Awaited<ReturnType<PasswordSource['reveal']>>
  ) => void)[] = [];
  source.reveal = () => new Promise((resolve) => reveals.push(resolve));
  source.copy = () => new Promise((resolve) => reveals.push(resolve));
  const clipboard = vi.fn(async (_value: string) => {});
  const viewer = createFixtureScope('account-a:1:fixture-team');
  let vault: VaultController | undefined;
  function Probe() {
    vault = createVault();
    return null;
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <PasswordsProvider
        value={{
          scope: viewer.scope,
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
  if (!vault) throw new Error('Fixture controller missing');
  const controller = vault;
  await waitFor(() => expect(controller.loadedItems()).toHaveLength(1));
  controller.select(saved.value);
  const reveal = controller.reveal();
  const copy = controller.copy();
  viewer.end();
  for (const resolve of reveals)
    resolve(ok({ values: LOGIN.values, version: 1 }));
  await Promise.all([reveal, copy]);
  expect(controller.values()).toBeUndefined();
  expect(controller.copied()).toBe(false);
  expect(clipboard).not.toHaveBeenCalled();
});

it('never carries a dirty draft into another account or sign-in session', async () => {
  const source = createFakePasswordSource();
  const [scopeKey, setScopeKey] = createSignal('account-a:1:fixture-team');
  const scopes = new Map<string, ReturnType<typeof createFixtureScope>>();
  const scopeFor = (key: string) => {
    const existing = scopes.get(key);
    if (existing) return existing;
    const created = createFixtureScope(key);
    scopes.set(key, created);
    return created;
  };
  const controllers: VaultController[] = [];
  function Probe() {
    controllers.push(createVault());
    return null;
  }
  render(() => (
    <QueryClientProvider client={new QueryClient()}>
      <Show when={scopeKey()} keyed>
        {(key) => (
          <PasswordsProvider
            value={{
              scope: scopeFor(key).scope,
              source,
              recipients: () => [],
              recipientsLoading: () => false,
              recipientsError: () => false,
              writeClipboard: async () => {},
            }}
          >
            <Probe />
          </PasswordsProvider>
        )}
      </Show>
    </QueryClientProvider>
  ));
  const first = controllers[0];
  const key = first.createItem('login', null);
  first.updateDraft(key, { ...LOGIN, name: 'Account A draft' });
  expect(first.dirty()).toBe(true);

  scopeFor('account-a:1:fixture-team').end();
  setScopeKey('account-b:2:fixture-team');

  expect(controllers).toHaveLength(2);
  const second = controllers[1];
  expect(second.dirty()).toBe(false);
  expect(second.drafts()).toEqual([]);
  expect(second.draft(key)).toBeUndefined();
});

it('opens an in-place edit with the revealed values and keeps it while selecting away', async () => {
  const source = createFakePasswordSource();
  const saved = await source.save(
    undefined,
    undefined,
    LOGIN,
    '019a0000-0000-7000-8000-000000000040'
  );
  if (saved.isErr()) throw new Error('Fixture save failed');
  const vault = mountVault(source);
  await waitFor(() => expect(vault.loadedItems()).toHaveLength(1));
  vault.select(saved.value);
  await vault.edit();
  expect(vault.activeDraft()?.draft.values.password).toBe('private-value');
  expect(vault.values()).toBeUndefined();
  vault.select(undefined);
  vault.select(saved.value);
  expect(vault.activeDraft()?.itemId).toBe(saved.value.id);
});

it('never opens an edit on an item the viewer may only view', async () => {
  const item: PasswordItem = {
    id: '019a0000-0000-7000-8000-000000000041',
    teamId: 'fixture-team',
    name: 'Viewed',
    kind: 'login',
    url: null,
    folderId: null,
    favorite: false,
    version: 1,
    hasTotp: false,
    shared: true,
    shareCount: 1,
    sharedWithTeam: false,
    canManage: false,
    canEdit: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastUsedAt: null,
  };
  const source = createFakePasswordSource([{ item, values: LOGIN.values }]);
  const reveal = vi.spyOn(source, 'reveal');
  const vault = mountVault(source);
  await waitFor(() => expect(vault.loadedItems()).toHaveLength(1));
  vault.select(item);
  await vault.edit();
  expect(vault.activeDraft()).toBeUndefined();
  expect(reveal).not.toHaveBeenCalled();
  // Viewing stays available: the value still reveals on request.
  await vault.reveal();
  expect(vault.values()?.password).toBe('private-value');
});
