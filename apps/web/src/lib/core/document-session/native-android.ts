import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import type { SessionAuthorization } from '@macro-inc/collaboration/session/executor';
import { Telemetry } from '@macro-inc/observability';
import { Channel, invoke } from '@tauri-apps/api/core';
import { RUST_EDITOR_ENGINE } from './engine-selection';
import type {
  AccountReply,
  ActionRequest,
  CreateRequest,
  LayoutRequest,
  LifecycleRequest,
  MenuCommitRequest,
  MenuIdentity,
  MenuRowsRequest,
  MountRequest,
  QueryReply,
  QueryRequest,
  SurfaceEvent,
  SurfacePermissions,
  SurfaceScope,
  TokenResultRequest,
} from './generated/native-bridge';
import { sessionSocketUrl } from './session-socket-url';

interface SurfaceOptions {
  request: Omit<CreateRequest, 'scope' | 'user'>;
  surfaceId: string;
  authorization: SessionAuthorization;
  onEvent(event: SurfaceEvent): void;
  onError(error: unknown): void;
}

let latestAccountGeneration = 0;
let accountEpoch = 0;
let accountQueue = Promise.resolve();

/** Explicit native capability, independent of the existing surface admission. */
export async function beginAndroidEditorAccount(user: string) {
  if (!RUST_EDITOR_ENGINE || !isPlatform('android')) {
    throw new Error('Native Android editing is unavailable');
  }
  const epoch = ++accountEpoch;
  const surfaces = new Map<string, ReturnType<typeof surface>>();
  const buffered: SurfaceEvent[] = [];
  let accountGeneration: number | undefined;
  let nextSurfaceGeneration = 0;
  let accountClosed = false;
  let accountClosing: Promise<void> | undefined;
  const channel = new Channel<SurfaceEvent>((event) => {
    if (accountGeneration === undefined) buffered.push(event);
    else receive(event);
  });
  const previousAccount = accountQueue;
  let releaseAccount = () => {};
  accountQueue = new Promise<void>((resolve) => {
    releaseAccount = resolve;
  });
  let reply: AccountReply;
  try {
    await previousAccount;
    if (epoch !== accountEpoch)
      throw new Error('Native account was replaced during creation');
    reply = await invoke<AccountReply>('plugin:native-editor|begin_account', {
      request: { user },
      channel,
    });
  } finally {
    releaseAccount();
  }
  if (
    epoch !== accountEpoch ||
    reply.accountGeneration <= latestAccountGeneration
  ) {
    throw new Error('Native account was replaced during creation');
  }
  accountGeneration = reply.accountGeneration;
  latestAccountGeneration = accountGeneration;
  for (const event of buffered) receive(event);
  buffered.length = 0;

  function receive(event: SurfaceEvent) {
    if (event.scope.accountGeneration !== accountGeneration) return;
    surfaces.get(event.scope.surfaceId)?.receive(event);
  }

  function surface(options: SurfaceOptions, scope: SurfaceScope) {
    let created = false;
    let creating = false;
    let admitted = false;
    let creation: Promise<void> | undefined;
    let controlQueue = Promise.resolve();
    let stopped = false;
    let closing: Promise<void> | undefined;
    let resolveStopped: (() => void) | undefined;
    let modelGeneration: number | undefined;
    let revision = 0;
    let nextMountGeneration = 0;
    let activeMountGeneration: number | undefined;
    let activeMenu: MenuIdentity | undefined;
    let permissions = { ...options.request.permissions };
    const pendingPermissions: SurfacePermissions[] = [];
    let unsubscribe = () => {};

    function current() {
      return (
        !stopped &&
        !closing &&
        !accountClosed &&
        epoch === accountEpoch &&
        accountGeneration === latestAccountGeneration
      );
    }
    function assertCurrent() {
      if (!current()) throw new Error('Native surface is no longer current');
    }
    function model() {
      assertCurrent();
      if (modelGeneration === undefined)
        throw new Error('Native surface is not ready');
      return modelGeneration;
    }
    function request<T>(
      command: string,
      payload: object,
      before?: () => void
    ): Promise<T> {
      const previous = controlQueue;
      const pending = (async () => {
        await previous;
        if (command === 'create') {
          if (epoch !== accountEpoch)
            throw new Error('Native account was replaced');
        } else if (command !== 'stop') assertCurrent();
        before?.();
        return await invoke<T>(`plugin:native-editor|${command}`, {
          request: payload,
        });
      })();
      controlQueue = (async () => {
        try {
          await pending;
        } catch {
          /* The operation's caller owns its error. */
        }
      })();
      return pending;
    }
    async function token(event: SurfaceEvent) {
      if (event.requestId === undefined || !current()) return;
      const packet: TokenResultRequest = {
        scope,
        requestId: event.requestId,
        access: 'none',
      };
      try {
        const result = await options.authorization.token(
          options.request.documentId
        );
        if (!current()) return;
        packet.token = result.token;
        if (result.access === 2) packet.access = 'full';
        else if (result.access === 1) packet.access = 'commentMarks';
        else if (result.access === 0) packet.access = 'none';
        else throw new Error('Unknown native token access');
        packet.socketUrl = sessionSocketUrl(
          options.request.documentId,
          result.token,
          options.request.traceparent ?? ''
        );
      } catch (error) {
        if (!current()) return;
        delete packet.token;
        delete packet.socketUrl;
        packet.access = 'none';
        try {
          await request<void>('token_result', packet);
        } finally {
          options.onError(error);
        }
        return;
      }
      if (current()) await request<void>('token_result', packet);
    }
    function currentMenu(identity: MenuIdentity) {
      return (
        current() &&
        activeMenu?.invocation === identity.invocation &&
        activeMenu.queryGeneration === identity.queryGeneration &&
        activeMountGeneration === identity.mountGeneration &&
        modelGeneration === identity.modelGeneration
      );
    }
    async function menuOperation(
      command: string,
      identity: MenuIdentity,
      payload: object
    ) {
      if (!currentMenu(identity)) return;
      const stale = new Error('Native menu was replaced');
      try {
        await request<void>(command, { ...payload, identity, scope }, () => {
          if (!currentMenu(identity)) throw stale;
        });
      } catch (error) {
        if (error !== stale) throw error;
      }
    }

    const api = {
      scope,
      menuRows(reply: Omit<MenuRowsRequest, 'scope'>) {
        return menuOperation('menu_rows', reply.identity, reply);
      },
      menuCommit(reply: Omit<MenuCommitRequest, 'scope'>) {
        return Telemetry.span('editor.native.menu.select', async (span) => {
          span.setAttr('document.id', options.request.documentId);
          span.setAttr('menu.kind', reply.choice.kind);
          await menuOperation('menu_commit', reply.identity, reply);
        });
      },
      receive(event: SurfaceEvent) {
        if (
          event.scope.surfaceGeneration !== scope.surfaceGeneration ||
          stopped
        )
          return;
        if (event.kind !== 'stopped' && !current()) return;
        if (event.kind === 'menu') {
          const menu = event.menu;
          if (
            !menu ||
            menu.query.identity.mountGeneration !== activeMountGeneration
          )
            return;
          const identity = menu.query.identity;
          if (identity.modelGeneration !== event.modelGeneration) return;
          if (
            activeMenu &&
            (identity.invocation < activeMenu.invocation ||
              (identity.invocation === activeMenu.invocation &&
                identity.queryGeneration < activeMenu.queryGeneration))
          )
            return;
          if (menu.action !== 'query' && !currentMenu(identity)) return;
          activeMenu = menu.action === 'closed' ? undefined : identity;
        }
        revision = event.revision;
        if (event.kind === 'ready') modelGeneration = event.modelGeneration;
        else if (modelGeneration !== undefined)
          modelGeneration = event.modelGeneration;
        if (event.kind === 'stopped') {
          stopped = true;
          unsubscribe();
          if (surfaces.get(scope.surfaceId) === api)
            surfaces.delete(scope.surfaceId);
          resolveStopped?.();
        }
        if (event.kind === 'token')
          fireAndForget(token(event), 'android-editor.token');
        options.onEvent(event);
      },
      create() {
        creation = (async () => {
          unsubscribe = options.authorization.subscribe(
            (isCurrent, canWrite, canComment) => {
              permissions = {
                ...permissions,
                current: isCurrent,
                canWrite,
                canComment,
              };
              if (!current()) return;
              if (created) {
                fireAndForget(
                  request<void>('permissions', {
                    scope,
                    permissions: { ...permissions },
                  }),
                  'android-editor.permissions'
                );
              } else if (creating) pendingPermissions.push({ ...permissions });
            }
          );
          try {
            if (!permissions.current)
              throw new Error('Native authorization is no longer current');
            creating = true;
            await request<void>('create', {
              ...options.request,
              scope,
              user,
              permissions,
            });
            admitted = true;
            while (pendingPermissions.length && current()) {
              await request<void>('permissions', {
                scope,
                permissions: pendingPermissions.shift(),
              });
            }
            assertCurrent();
            created = true;
            creating = false;
          } catch (error) {
            unsubscribe();
            throw error;
          }
        })();
        return creation;
      },
      async mount(appearance: Omit<MountRequest, 'scope' | 'mountGeneration'>) {
        assertCurrent();
        if (nextMountGeneration === 0xffffffff)
          throw new Error('Native mount generation exhausted');
        const mountGeneration = ++nextMountGeneration;
        await request<void>('mount', { ...appearance, scope, mountGeneration });
        assertCurrent();
        activeMountGeneration = mountGeneration;
        let closed = false;
        let unmounting: Promise<void> | undefined;
        function assertMount() {
          assertCurrent();
          if (closed || activeMountGeneration !== mountGeneration)
            throw new Error('Native mount is no longer current');
        }
        return {
          layout(bounds: Omit<LayoutRequest, 'scope' | 'mountGeneration'>) {
            assertMount();
            return request<void>(
              'layout',
              { ...bounds, scope, mountGeneration },
              assertMount
            );
          },
          focus(focused: boolean) {
            assertMount();
            return request<void>(
              'focus',
              { scope, mountGeneration, focused },
              assertMount
            );
          },
          unmount(): Promise<void> {
            if (unmounting) return unmounting;
            closed = true;
            if (!current() || activeMountGeneration !== mountGeneration)
              return Promise.resolve();
            unmounting = (async () => {
              try {
                await request<void>(
                  'unmount',
                  { scope, mountGeneration },
                  () => {
                    assertCurrent();
                    if (activeMountGeneration !== mountGeneration)
                      throw new Error('Native mount was replaced');
                  }
                );
                if (activeMountGeneration === mountGeneration)
                  activeMountGeneration = undefined;
              } catch (error) {
                if (!current() || activeMountGeneration !== mountGeneration)
                  return;
                unmounting = undefined;
                closed = false;
                throw error;
              }
            })();
            return unmounting;
          },
        };
      },
      permissions(editorEditable: boolean, contentInteractable: boolean) {
        assertCurrent();
        permissions = { ...permissions, editorEditable, contentInteractable };
        return request<void>('permissions', { scope, permissions });
      },
      action(action: Omit<ActionRequest, 'scope' | 'modelGeneration'>) {
        return request<void>('action', {
          ...action,
          scope,
          modelGeneration: model(),
        });
      },
      async query(
        query: Omit<QueryRequest, 'scope' | 'modelGeneration'>
      ): Promise<unknown> {
        const generation = model();
        const reply = await request<QueryReply>('query', {
          ...query,
          scope,
          modelGeneration: generation,
        });
        assertCurrent();
        if (generation !== modelGeneration)
          throw new Error('Native model changed during query');
        return JSON.parse(reply.json);
      },
      lifecycle(signal: LifecycleRequest['signal']) {
        assertCurrent();
        return request<void>('lifecycle', { scope, signal });
      },
      revision: () => revision,
      close(): Promise<void> {
        if (stopped) return Promise.resolve();
        if (closing) return closing;
        closing = (async () => {
          // Publish closing before a synchronous terminal channel event can reenter.
          await Promise.resolve();
          try {
            await creation;
          } catch {
            /* Failed creation has no admitted lifetime. */
          }
          if (stopped) return;
          if (!admitted) {
            stopped = true;
            unsubscribe();
            return;
          }
          const drained = new Promise<void>((resolve) => {
            resolveStopped = resolve;
          });
          try {
            await request<void>('stop', scope);
            await drained;
          } catch (error) {
            if (stopped) return;
            closing = undefined;
            resolveStopped = undefined;
            throw error;
          }
        })();
        return closing;
      },
    };
    return api;
  }

  return {
    async create(options: SurfaceOptions) {
      if (
        accountClosed ||
        epoch !== accountEpoch ||
        accountGeneration !== latestAccountGeneration
      )
        throw new Error('Native account was replaced');
      if (surfaces.has(options.surfaceId))
        throw new Error('Native surface already exists');
      if (nextSurfaceGeneration === 0xffffffff)
        throw new Error('Native surface generation exhausted');
      const scope: SurfaceScope = {
        accountGeneration,
        surfaceId: options.surfaceId,
        surfaceGeneration: ++nextSurfaceGeneration,
      };
      const api = surface(options, scope);
      surfaces.set(options.surfaceId, api);
      try {
        await api.create();
      } catch (error) {
        await api.close();
        if (surfaces.get(options.surfaceId) === api)
          surfaces.delete(options.surfaceId);
        throw error;
      }
      return {
        scope: api.scope,
        mount: api.mount,
        menuRows: api.menuRows,
        menuCommit: api.menuCommit,
        permissions: api.permissions,
        action: api.action,
        query: api.query,
        lifecycle: api.lifecycle,
        revision: api.revision,
        close: api.close,
      };
    },
    close() {
      accountClosed = true;
      accountClosing ??= (async () => {
        try {
          await Promise.all(
            [...surfaces.values()].map((surface) => surface.close())
          );
        } catch (error) {
          accountClosing = undefined;
          throw error;
        }
      })();
      return accountClosing;
    },
  };
}

export type NativeAndroidSurface = Awaited<
  ReturnType<Awaited<ReturnType<typeof beginAndroidEditorAccount>>['create']>
>;
