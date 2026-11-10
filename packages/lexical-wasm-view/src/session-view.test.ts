/** @vitest-environment jsdom */
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import { Telemetry } from '@macro-inc/observability';
import { onCleanup } from 'solid-js';
import { beforeAll, expect, test, vi } from 'vitest';
import { EditorSession } from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountSessionView } from './session-view';
import { EditorView } from './view/editor-view';
import { createBuiltinRegistry } from './view/node-views/builtins';
import { registerMacroDecoratorViews } from './view/node-views/macro';
import { initializeNativeSurfaceTests } from './view/test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test('constructor authorization waits for the one synchronous view and detach retires observation once', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const span = Telemetry.span('editor.observer-test');
  const telemetry = new SessionTelemetry(span);
  const authorization: boolean[] = [];
  const attached: boolean[] = [];
  const unsubscribe = vi.fn();
  let publish:
    | ((current: boolean, write: boolean, comment: boolean) => void)
    | undefined;
  let retire: ReturnType<typeof vi.fn<() => void>> | undefined;
  let postTeardownAdmissions = 0;
  let onDispose = () => {};
  let reentrantClose: Promise<void> | undefined;
  let freed = 0;
  let secondMountRejected = false;
  const registry = registerMacroDecoratorViews(createBuiltinRegistry(), {
    image: () => {
      onCleanup(() => onDispose());
      return document.createTextNode('actual image lifetime');
    },
  });
  const runtime = mountSessionView(
    root,
    registry,
    {
      namespace: 'observer-test',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    },
    {
      doc: 'observer-test',
      owner: '00000000-0000-0000-0000-000000000001',
      user: 'fixture-user',
      locks,
      create(now, wall) {
        const native = EditorSession.createMacro(
          ABI_MAJOR,
          SessionConfigMsg.encode({
            doc: 'observer-test',
            session: '00000000-0000-0000-0000-000000000001',
            user: 'fixture-user',
            peers: [7n, 8n, 9n],
            access: Access.Edit,
            transport: Transport.None,
            durable: false,
            chatter: false,
            headless: false,
            viewEngine: 1,
            viewOs: 0,
            token: '',
            traceparent: '',
            coalesce: 25,
            snapshotInterval: 0,
            observed: [],
          }),
          now,
          wall
        );
        const original = native.authorization.bind(native);
        vi.spyOn(native, 'authorization').mockImplementation((...args) => {
          authorization.push(args[1]);
          attached.push(EditorView.fromDOM(root) !== null);
          return original(...args);
        });
        const originalRetire = native.retireViewObservation.bind(native);
        retire = vi.fn(() => originalRetire());
        vi.spyOn(native, 'retireViewObservation').mockImplementation(retire);
        const free = native.free.bind(native);
        vi.spyOn(native, 'free').mockImplementation(() => {
          freed++;
          free();
        });
        return native;
      },
      auth: {
        token: async () => {
          throw new Error('No transport in observer test');
        },
        subscribe(callback) {
          publish = callback;
          callback(true, false, false);
          callback(true, true, true);
          return unsubscribe;
        },
      },
      socketUrl() {
        throw new Error('No transport in observer test');
      },
      telemetry,
    }
  );
  try {
    expect(authorization).toEqual([false, true]);
    expect(attached).toEqual([true, true]);
    runtime.executor.run(() =>
      runtime.executor.session.input(
        SessionInputMsg.encode(emptyInput(1)),
        runtime.executor.now(),
        Date.now()
      )
    );
    runtime.port.setState(
      '{"root":{"type":"root","version":1,"children":[{"type":"image","version":1,"srcType":"url","id":"fixture-image","url":"https://example.com/image","width":320,"height":160,"scale":1,"alt":""}]}}'
    );
    const image = [...runtime.view.mirror.values()].find(
      (node) => node.type === 'image'
    );
    if (!image) throw new Error('Missing actual native image');
    expect(image.decoratorRevision).toBe(0n);
    const firstHost = runtime.view.getElementByKey(
      image.key
    )?.firstElementChild;
    const model = runtime.executor.session.serializedState();
    runtime.port.initialize();
    expect(runtime.executor.session.serializedState()).toBe(model);
    expect(runtime.view.getElementByKey(image.key)?.firstElementChild).not.toBe(
      firstHost
    );
    expect(runtime.view.node(image.key)?.decoratorRevision).toBe(0n);
  } finally {
    onDispose = () => {
      reentrantClose = runtime.close();
      try {
        mountSessionView(
          document.createElement('div'),
          createBuiltinRegistry(),
          {
            namespace: 'duplicate-owner',
            theme: {},
            editable: true,
            preset: 'rich',
            onError(error) {
              throw error;
            },
          },
          {
            doc: 'duplicate-owner',
            owner: '00000000-0000-0000-0000-000000000003',
            user: 'fixture-user',
            locks,
            create: () => runtime.executor.session,
            auth: {
              token: async () => {
                throw new Error('No duplicate transport');
              },
              subscribe: () => () => {},
            },
            socketUrl() {
              throw new Error('No duplicate transport');
            },
            telemetry: new SessionTelemetry(
              Telemetry.span('editor.duplicate-owner-test')
            ),
          }
        );
      } catch (error) {
        secondMountRejected =
          error instanceof Error &&
          error.message === 'Native session already belongs to an editor view';
      }
    };
    const closed = runtime.close();
    expect(runtime.close()).toBe(closed);
    expect(reentrantClose).toBe(closed);
    const before = authorization.length;
    publish?.(true, false, false);
    postTeardownAdmissions = authorization.length - before;
    await closed;
    telemetry.close();
    span.end();
    root.remove();
  }
  expect(retire).toHaveBeenCalledTimes(1);
  expect(EditorView.fromDOM(root)).toBeNull();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(postTeardownAdmissions).toBe(0);
  expect(secondMountRejected).toBe(true);
  expect(freed).toBe(1);
});

test.each([undefined, null, { opaque: 'mount failure' }])(
  'failed subscription preserves its exact cause and drains close despite disposal failure: %j',
  async (primary) => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const released = Promise.withResolvers<void>();
    let freed = 0;
    let retired = 0;
    let disposed = 0;
    let authorization = 0;
    let caught: { value: unknown } | undefined;
    const actualMount = EditorView.mount;
    const mount = vi
      .spyOn(EditorView, 'mount')
      .mockImplementationOnce((...args) => {
        const view = actualMount(...args);
        const actualDispose = view.dispose.bind(view);
        vi.spyOn(view, 'dispose').mockImplementation(() => {
          disposed++;
          actualDispose();
          throw new Error('Secondary view disposal failure');
        });
        return view;
      });
    try {
      mountSessionView(
        root,
        createBuiltinRegistry(),
        {
          namespace: 'failed-observer',
          theme: {},
          editable: true,
          preset: 'rich',
          onError(error) {
            throw error;
          },
        },
        {
          doc: 'failed-observer',
          owner: '00000000-0000-0000-0000-000000000002',
          user: 'fixture-user',
          locks,
          create(now, wall) {
            const native = EditorSession.createMacro(
              ABI_MAJOR,
              SessionConfigMsg.encode({
                doc: 'failed-observer',
                session: '00000000-0000-0000-0000-000000000002',
                user: 'fixture-user',
                peers: [17n, 18n, 19n],
                access: Access.Edit,
                transport: Transport.None,
                durable: false,
                chatter: false,
                headless: false,
                viewEngine: 1,
                viewOs: 0,
                token: '',
                traceparent: '',
                coalesce: 25,
                snapshotInterval: 0,
                observed: [],
              }),
              now,
              wall
            );
            const free = native.free.bind(native);
            vi.spyOn(native, 'free').mockImplementation(() => {
              freed++;
              free();
              released.resolve();
            });
            const retire = native.retireViewObservation.bind(native);
            vi.spyOn(native, 'retireViewObservation').mockImplementation(() => {
              retired++;
              retire();
            });
            const authorize = native.authorization.bind(native);
            vi.spyOn(native, 'authorization').mockImplementation((...args) => {
              authorization++;
              return authorize(...args);
            });
            return native;
          },
          auth: {
            async token() {
              throw new Error('No transport in failed observer test');
            },
            subscribe(callback) {
              callback(true, false, false);
              throw primary;
            },
          },
          socketUrl() {
            throw new Error('No transport in failed observer test');
          },
          telemetry: new SessionTelemetry(
            Telemetry.span('editor.failed-observer-test')
          ),
        }
      );
    } catch (value) {
      caught = { value };
    } finally {
      mount.mockRestore();
    }
    expect(caught).toEqual({ value: primary });
    await released.promise;
    expect(freed).toBe(1);
    expect(retired).toBe(1);
    expect(disposed).toBe(1);
    expect(authorization).toBe(0);
    expect(EditorView.fromDOM(root)).toBeNull();
    root.remove();
  }
);
