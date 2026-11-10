/** @vitest-environment jsdom */
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { SessionExecutor } from '@macro-inc/collaboration/session/executor';
import { ownerLock } from '@macro-inc/collaboration/session/storage';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import { NOOP_SPAN } from '@macro-inc/observability';
import { beforeAll, expect, test, vi } from 'vitest';
import { EditorSession } from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { initializeNativeSurfaceTests } from './view/test/native-surface';

beforeAll(initializeNativeSurfaceTests);

test.each(['create', 'lease', 'storage', 'channel', 'auth'] as const)(
  'executor construction failure at %s releases accepted resources and preserves the exact cause',
  async (stage) => {
    const doc = `construction-${stage}`;
    const owner = '00000000-0000-0000-0000-000000000001';
    const primary = stage === 'auth' ? undefined : { stage };
    let caught: { value: unknown } | undefined;
    let freed = 0;
    let retired = 0;
    let closedChannel = 0;
    const request = vi.spyOn(locks, 'request');
    if (stage === 'lease')
      request.mockImplementationOnce(() => {
        throw primary;
      });
    try {
      new SessionExecutor({
        doc,
        owner,
        user: 'fixture-user',
        locks,
        create(now, wall) {
          if (stage === 'create') throw primary;
          const native = EditorSession.createMacro(
            ABI_MAJOR,
            SessionConfigMsg.encode({
              doc,
              session: owner,
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
          const free = native.free.bind(native);
          vi.spyOn(native, 'free').mockImplementation(() => {
            freed++;
            free();
          });
          return native;
        },
        onConstructionFailure(native) {
          retired++;
          native.retireViewObservation();
          if (stage === 'auth')
            throw new Error('Secondary retirement callback failure');
        },
        get storage() {
          if (stage === 'storage') throw primary;
          return undefined;
        },
        get channel() {
          if (stage === 'channel') throw primary;
          const channel = new BroadcastChannel(doc);
          const close = channel.close.bind(channel);
          vi.spyOn(channel, 'close').mockImplementation(() => {
            closedChannel++;
            close();
          });
          return channel;
        },
        auth: {
          async token() {
            throw new Error('No transport in construction test');
          },
          subscribe() {
            throw primary;
          },
        },
        socketUrl() {
          throw new Error('No transport in construction test');
        },
        telemetry: new SessionTelemetry(NOOP_SPAN),
        view: {
          apply() {
            throw new Error('Construction must not transfer view output');
          },
        },
      });
    } catch (value) {
      caught = { value };
    } finally {
      request.mockRestore();
    }
    expect(caught).toEqual({ value: primary });
    expect(freed).toBe(stage === 'create' ? 0 : 1);
    expect(retired).toBe(stage === 'create' ? 0 : 1);
    expect(closedChannel).toBe(stage === 'auth' ? 1 : 0);
    // A real Web Lock request waits behind the failed constructor's pending/held lease.
    await locks.request(ownerLock(doc, owner), () => undefined);
    expect(
      (await locks.query()).held?.some(
        (lock) => lock.name === ownerLock(doc, owner)
      )
    ).toBe(false);
  }
);
