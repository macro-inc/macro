import type { SessionAuthorization } from '@macro-inc/collaboration/session/executor';
import { beforeEach, expect, test, vi } from 'vitest';
import type {
  CreateRequest,
  SurfaceEvent,
  SurfaceScope,
} from './generated/native-bridge';

const native = vi.hoisted(() => ({
  enabled: true,
  android: true,
  account: 0,
  channels: [] as ((event: SurfaceEvent) => void)[],
  tasks: [] as Promise<unknown>[],
  invoke: vi.fn<(command: string, args: object) => Promise<unknown>>(),
}));
vi.mock('./engine-selection', () => ({
  get RUST_EDITOR_ENGINE() {
    return native.enabled;
  },
}));
vi.mock('@core/util/platform', () => ({ isPlatform: () => native.android }));
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (work: Promise<unknown>) => {
    native.tasks.push(work);
  },
}));
vi.mock('./session-socket-url', () => ({
  sessionSocketUrl: (doc: string, token: string) =>
    `wss://sync.example.com/document/${doc}/connect?token=${token}`,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: native.invoke,
  Channel: class {
    constructor(callback: (event: SurfaceEvent) => void) {
      native.channels.push(callback);
    }
  },
}));
const scope: SurfaceScope = {
  accountGeneration: 1,
  surfaceGeneration: 1,
  surfaceId: 'fixture',
};
const request: Omit<CreateRequest, 'scope' | 'user'> = {
  documentId: 'fixture-document',
  sessionId: '00000000-0000-0000-0000-000000000001',
  access: 'edit',
  durable: false,
  hostname: 'app.example.com',
  preset: 'markdown',
  presenceColor: 'blue',
  presenceTimeoutMs: 10000,
  snapshotIntervalMs: 15000,
  snapshotBase64: '',
  transport: 'none',
  permissions: {
    current: true,
    canWrite: true,
    canComment: true,
    editorEditable: true,
    contentInteractable: true,
  },
};
function emit(kind: SurfaceEvent['kind'], extras: Partial<SurfaceEvent> = {}) {
  native.channels[0]({
    kind,
    scope,
    revision: 2,
    modelGeneration: 42,
    ...extras,
  });
}
function authorization(
  token: SessionAuthorization['token'] = async () => ({
    token: 'fixture-token',
    access: 2,
  })
) {
  const unsubscribe = vi.fn();
  return { token, subscribe: vi.fn(() => unsubscribe), unsubscribe };
}
beforeEach(() => {
  vi.resetModules();
  native.enabled = true;
  native.android = true;
  native.account = 0;
  native.channels.length = 0;
  native.tasks.length = 0;
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|begin_account'))
      return { accountGeneration: ++native.account };
    if (command.endsWith('|create')) emit('ready');
    if (command.endsWith('|query')) return { json: '"native text"' };
    return null;
  });
});
test('native creation requires the frozen engine and Android', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  native.enabled = false;
  await expect(beginAndroidEditorAccount('fixture-user')).rejects.toThrow(
    'unavailable'
  );
  native.enabled = true;
  native.android = false;
  await expect(beginAndroidEditorAccount('fixture-user')).rejects.toThrow(
    'unavailable'
  );
  expect(native.invoke).not.toHaveBeenCalled();
});
test('ready during creation supplies model generation to actions and queries', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const onEvent = vi.fn();
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent,
    onError: vi.fn(),
  });
  await surface.action({ kind: 'command', name: 'undo' });
  expect(native.invoke).toHaveBeenCalledWith('plugin:native-editor|action', {
    request: { kind: 'command', name: 'undo', scope, modelGeneration: 42 },
  });
  expect(await surface.query({ kind: 'text' })).toBe('native text');
  emit('changed', {
    scope: { ...scope, surfaceGeneration: 0 },
    modelGeneration: 99,
  });
  expect(onEvent).toHaveBeenCalledTimes(1);
});
test('token completing after account replacement never enters transport', async () => {
  let complete:
    | ((result: { token: string; access: number }) => void)
    | undefined;
  const fetched = new Promise<{ token: string; access: number }>((resolve) => {
    complete = resolve;
  });
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(() => fetched),
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  emit('token', { requestId: 7 });
  await beginAndroidEditorAccount('other-fixture-user');
  complete?.({ token: 'late-token', access: 2 });
  await Promise.all(native.tasks);
  expect(
    native.invoke.mock.calls.some(([command]) =>
      command.endsWith('|token_result')
    )
  ).toBe(false);
});
test('close waits for stopped acknowledgement and unsubscribes once', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const auth = authorization();
  const account = await beginAndroidEditorAccount('fixture-user');
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: auth,
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  let stopStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    stopStarted = resolve;
  });
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|stop')) stopStarted?.();
    return null;
  });
  const closing = surface.close();
  expect(surface.close()).toBe(closing);
  await started;
  expect(auth.unsubscribe).not.toHaveBeenCalled();
  emit('stopped');
  await closing;
  expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  expect(() => surface.action({ kind: 'command', name: 'undo' })).toThrow(
    'no longer current'
  );
});
test('queries reject replies from a replaced model', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  let complete: ((reply: { json: string }) => void) | undefined;
  let queryStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    queryStarted = resolve;
  });
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
        queryStarted?.();
      })
  );
  const pending = surface.query({ kind: 'state' });
  await started;
  emit('ready', { modelGeneration: 43 });
  complete?.({ json: '{}' });
  await expect(pending).rejects.toThrow('model changed');
});

test('unknown token access completes a clean denial', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const onError = vi.fn();
  const account = await beginAndroidEditorAccount('fixture-user');
  await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(async () => ({
      token: 'invalid-token',
      access: 99,
    })),
    onEvent: vi.fn(),
    onError,
  });
  emit('token', { requestId: 9 });
  await Promise.all(native.tasks);
  expect(native.invoke).toHaveBeenCalledWith(
    'plugin:native-editor|token_result',
    { request: { scope, requestId: 9, access: 'none' } }
  );
  expect(onError).toHaveBeenCalledTimes(1);
});

test('account replacement serializes native invocation completion', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  let releaseFirst:
    | ((reply: { accountGeneration: number }) => void)
    | undefined;
  let firstStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  native.invoke.mockImplementation(async () => {
    native.account++;
    if (native.account === 1) {
      firstStarted?.();
      return new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
    return { accountGeneration: native.account };
  });
  const first = beginAndroidEditorAccount('fixture-user');
  const rejected = expect(first).rejects.toThrow('replaced');
  await started;
  const second = beginAndroidEditorAccount('other-fixture-user');
  expect(native.invoke).toHaveBeenCalledTimes(1);
  releaseFirst?.({ accountGeneration: 1 });
  await rejected;
  await second;
  expect(native.invoke).toHaveBeenCalledTimes(2);
});

test('account close drains creation before sending stop and forbids further creation', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  let releaseCreate: (() => void) | undefined;
  let createStarted: (() => void) | undefined;
  const startedCreate = new Promise<void>((resolve) => {
    createStarted = resolve;
  });
  let stopStarted: (() => void) | undefined;
  const stopping = new Promise<void>((resolve) => {
    stopStarted = resolve;
  });
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|create'))
      return new Promise<void>((resolve) => {
        releaseCreate = resolve;
        createStarted?.();
      });
    if (command.endsWith('|stop')) {
      stopStarted?.();
      emit('stopped');
    }
    return null;
  });
  const options = {
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent: vi.fn(),
    onError: vi.fn(),
  };
  const creating = account.create(options);
  const rejected = expect(creating).rejects.toThrow('no longer current');
  await startedCreate;
  const closing = account.close();
  expect(
    native.invoke.mock.calls.some(([command]) => command.endsWith('|stop'))
  ).toBe(false);
  releaseCreate?.();
  await stopping;
  await closing;
  await rejected;
  await expect(account.create(options)).rejects.toThrow('replaced');
});

test('synchronous authorization is applied once before queued create-time updates', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  let update:
    | ((current: boolean, write: boolean, comment: boolean) => void)
    | undefined;
  const auth = {
    token: authorization().token,
    subscribe(
      callback: (current: boolean, write: boolean, comment: boolean) => void
    ) {
      update = callback;
      callback(true, false, true);
      return vi.fn();
    },
  };
  let releaseCreate: (() => void) | undefined;
  let createStarted: (() => void) | undefined;
  const startedCreate = new Promise<void>((resolve) => {
    createStarted = resolve;
  });
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|create'))
      return new Promise<void>((resolve) => {
        releaseCreate = resolve;
        createStarted?.();
      });
    return null;
  });
  const creating = account.create({
    request,
    surfaceId: 'fixture',
    authorization: auth,
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  await startedCreate;
  expect(native.invoke).toHaveBeenLastCalledWith(
    'plugin:native-editor|create',
    {
      request: {
        ...request,
        scope,
        user: 'fixture-user',
        permissions: { ...request.permissions, canWrite: false },
      },
    }
  );
  update?.(true, true, true);
  releaseCreate?.();
  await creating;
  const updates = native.invoke.mock.calls.filter(([command]) =>
    command.endsWith('|permissions')
  );
  expect(updates).toHaveLength(1);
  expect(updates[0][1]).toEqual({
    request: { scope, permissions: request.permissions },
  });
});

test('replacing an account suppresses old UI callbacks while still draining stop', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const auth = authorization();
  const onEvent = vi.fn();
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: auth,
    onEvent,
    onError: vi.fn(),
  });
  let completeAccount:
    | ((reply: { accountGeneration: number }) => void)
    | undefined;
  native.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        completeAccount = resolve;
      })
  );
  const replacement = beginAndroidEditorAccount('other-fixture-user');
  emit('plugin', { name: 'late-provider' });
  emit('changed', { revision: 99 });
  expect(onEvent).toHaveBeenCalledTimes(1);
  emit('stopped');
  expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
  await surface.close();
  // The new native invocation is intentionally blocked behind its queue handoff.
  await Promise.resolve();
  completeAccount?.({ accountGeneration: 2 });
  await replacement;
});

test('permission changes stay ordered across subscription and explicit controls', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  let update:
    | ((current: boolean, write: boolean, comment: boolean) => void)
    | undefined;
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    onEvent: vi.fn(),
    onError: vi.fn(),
    authorization: {
      token: authorization().token,
      subscribe(callback) {
        update = callback;
        return vi.fn();
      },
    },
  });
  let releaseFirst: (() => void) | undefined;
  let firstStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  let count = 0;
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|permissions') && ++count === 1) {
      firstStarted?.();
      return new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return null;
  });
  const first = surface.permissions(false, false);
  await started;
  update?.(true, false, true);
  const last = surface.permissions(true, true);
  expect(count).toBe(1);
  releaseFirst?.();
  await Promise.all([first, last, ...native.tasks]);
  expect(count).toBe(3);
  expect(native.invoke).toHaveBeenLastCalledWith(
    'plugin:native-editor|permissions',
    {
      request: {
        scope,
        permissions: { ...request.permissions, canWrite: false },
      },
    }
  );
});

const appearance = {
  ariaLabel: 'Fixture editor',
  darkMode: false,
  fontSizeCssPx: 16,
  lineHeightCssPx: 24,
  placeholder: '',
  textColorArgb: 0xff000000,
  hintColorArgb: 0xff808080,
};
const bounds = {
  left: 0,
  top: 0,
  width: 100,
  height: 40,
  viewportWidth: 100,
  clipLeft: 0,
  clipTop: 0,
  clipRight: 100,
  clipBottom: 40,
  visible: true,
};

test('replaced mount callbacks cannot move, focus or unmount the current native view', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  const first = await surface.mount(appearance);
  const second = await surface.mount(appearance);
  expect(() => first.layout(bounds)).toThrow('mount is no longer current');
  expect(() => first.focus(true)).toThrow('mount is no longer current');
  await first.unmount();
  expect(
    native.invoke.mock.calls.some(([command]) => command.endsWith('|unmount'))
  ).toBe(false);
  await second.layout(bounds);
  expect(native.invoke).toHaveBeenLastCalledWith(
    'plugin:native-editor|layout',
    { request: { ...bounds, scope, mountGeneration: 2 } }
  );
  const unmounting = second.unmount();
  expect(second.unmount()).toBe(unmounting);
  await unmounting;
  expect(() => second.focus(true)).toThrow('mount is no longer current');
  expect(await surface.query({ kind: 'text' })).toBe('native text');
});

test('old mount cleanup queued behind replacement is cancelled before native admission', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  const first = await surface.mount(appearance);
  let releaseMount: (() => void) | undefined;
  let mountStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    mountStarted = resolve;
  });
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|mount'))
      return new Promise<void>((resolve) => {
        releaseMount = resolve;
        mountStarted?.();
      });
    return null;
  });
  const mounting = surface.mount(appearance);
  await started;
  const oldCleanup = first.unmount();
  releaseMount?.();
  const second = await mounting;
  await oldCleanup;
  expect(
    native.invoke.mock.calls.some(([command]) => command.endsWith('|unmount'))
  ).toBe(false);
  await second.focus(true);
  expect(native.invoke).toHaveBeenLastCalledWith('plugin:native-editor|focus', {
    request: { scope, mountGeneration: 2, focused: true },
  });
});

test('failed unmount can retry without losing its retained native lease', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  const mount = await surface.mount(appearance);
  let unmounts = 0;
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|unmount') && ++unmounts === 1)
      throw new Error('fixture unmount failure');
    return null;
  });
  await expect(mount.unmount()).rejects.toThrow('fixture unmount failure');
  await mount.focus(true);
  await mount.unmount();
  expect(unmounts).toBe(2);
});

test('menu replies and selections remain bound to the live invocation query and mount', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const onEvent = vi.fn();
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent,
    onError: vi.fn(),
  });
  const mount = await surface.mount(appearance);
  const identity = {
    invocation: 1,
    modelGeneration: 42,
    mountGeneration: 1,
    queryGeneration: 1,
  };
  const query = {
    identity,
    kind: 'mention' as const,
    term: 'p',
    selectedIndex: 0,
    nodeTypes: ['paragraph', 'user-mention'],
  };
  emit('menu', { menu: { action: 'query', query } });
  const reply = {
    identity,
    rows: [{ id: 'person', bucketId: 'users', label: 'Person' }],
    buckets: [
      {
        id: 'users',
        label: 'People',
        loadedCount: 1,
        hasMore: false,
        isLoading: false,
        isLoadingMore: false,
      },
    ],
  };
  await surface.menuRows(reply);
  expect(native.invoke).toHaveBeenCalledWith('plugin:native-editor|menu_rows', {
    request: { ...reply, scope },
  });
  emit('menu', {
    menu: {
      action: 'query',
      query: {
        ...query,
        identity: { ...identity, queryGeneration: 2 },
        term: 'pe',
      },
    },
  });
  native.invoke.mockClear();
  await surface.menuRows(reply);
  await surface.menuCommit({
    identity,
    rowId: 'person',
    choice: {
      kind: 'user',
      user: { userId: 'fixture-user', displayName: 'Person' },
    },
  });
  expect(native.invoke).not.toHaveBeenCalled();
  await mount.unmount();
  const count = onEvent.mock.calls.length;
  emit('menu', { menu: { action: 'query', query } });
  expect(onEvent).toHaveBeenCalledTimes(count);
});

test('a menu answer queued before a query change is dropped before IPC', async () => {
  const { beginAndroidEditorAccount } = await import('./native-android');
  const account = await beginAndroidEditorAccount('fixture-user');
  const surface = await account.create({
    request,
    surfaceId: 'fixture',
    authorization: authorization(),
    onEvent: vi.fn(),
    onError: vi.fn(),
  });
  await surface.mount(appearance);
  const identity = {
    invocation: 1,
    modelGeneration: 42,
    mountGeneration: 1,
    queryGeneration: 1,
  };
  const query = {
    identity,
    kind: 'mention' as const,
    term: 'p',
    selectedIndex: 0,
    nodeTypes: ['user-mention'],
  };
  emit('menu', { menu: { action: 'query', query } });
  let finish: ((result: { json: string }) => void) | undefined;
  let start: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const blocked = new Promise<{ json: string }>((resolve) => {
    finish = resolve;
  });
  native.invoke.mockImplementation(async (command) => {
    if (command.endsWith('|query')) {
      start?.();
      return await blocked;
    }
    return null;
  });
  const running = surface.query({ kind: 'text' });
  await started;
  const late = surface.menuRows({ identity, rows: [], buckets: [] });
  emit('menu', {
    menu: {
      action: 'query',
      query: {
        ...query,
        identity: { ...identity, queryGeneration: 2 },
        term: 'pe',
      },
    },
  });
  emit('menu', { menu: { action: 'closed', query } });
  finish?.({ json: '"native text"' });
  await running;
  await late;
  expect(
    native.invoke.mock.calls.filter(([command]) =>
      command.endsWith('|menu_rows')
    )
  ).toHaveLength(0);
  await surface.menuRows({
    identity: { ...identity, queryGeneration: 2 },
    rows: [],
    buckets: [],
  });
  expect(
    native.invoke.mock.calls.filter(([command]) =>
      command.endsWith('|menu_rows')
    )
  ).toHaveLength(1);
});
