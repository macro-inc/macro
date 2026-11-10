import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { locks } from 'node:worker_threads';
import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { beforeAll, expect, test, vi } from 'vitest';
import {
  EditorSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from './abi.generated';
import {
  type ExecutorFailure,
  type ExecutorOptions,
  SessionExecutor,
} from './executor';
import { emptyInput } from './input';
import { SessionTelemetry } from './telemetry';

beforeAll(() => {
  initSync({
    module: readFileSync(
      new URL(
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm',
        import.meta.url
      )
    ),
  });
});

function createExecutor(
  hooks: Pick<ExecutorOptions<EditorSession>, 'beforeConsume' | 'afterDrain'>,
  apply: () => void = () => {}
) {
  const doc = `drain-${crypto.randomUUID()}`;
  const owner = crypto.randomUUID();
  return new SessionExecutor({
    ...hooks,
    doc,
    owner,
    user: 'fixture-user',
    locks,
    create: (now, wall) =>
      EditorSession.createMacro(
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
      ),
    auth: {
      token: async () => {
        throw new Error('No transport in drain test');
      },
      subscribe: () => () => {},
    },
    view: { apply },
    socketUrl: () => {
      throw new Error('No transport in drain test');
    },
    telemetry: new SessionTelemetry(NOOP_SPAN),
  });
}

test('native output is fenced before transfer and the outer FIFO drains once', async () => {
  const order: string[] = [];
  const flags: number[] = [];
  const executor = createExecutor(
    {
      beforeConsume: (value) => {
        flags.push(value);
        order.push('before');
      },
      afterDrain: (failure) => {
        expect(failure).toBeUndefined();
        order.push('drained');
      },
    },
    () => order.push('output')
  );
  try {
    executor.run(
      () => {
        order.push('initialize');
        executor.run(
          () => {
            order.push('queued');
            return executor.session.tick(executor.now(), Date.now());
          },
          () => order.push('queued-completion')
        );
        return executor.session.input(
          SessionInputMsg.encode(emptyInput(1)),
          executor.now(),
          Date.now()
        );
      },
      () => order.push('completion')
    );
    expect(flags).toHaveLength(2);
    expect(order).toEqual([
      'initialize',
      'before',
      'output',
      'completion',
      'queued',
      'before',
      'queued-completion',
      'drained',
    ]);
  } finally {
    await executor.close();
  }
});

test.each([undefined, null, { reason: 'opaque' }])(
  'drain cleanup cannot replace an aborted admission cause %j',
  async (cause) => {
    const secondary = { reason: 'cleanup' };
    const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    let cleanupThrows = true;
    const executor = createExecutor({
      afterDrain: () => {
        if (cleanupThrows) throw secondary;
      },
    });
    try {
      let caught = false;
      try {
        executor.runSync(() => {
          throw cause;
        });
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(true);
      expect(report).toHaveBeenCalledExactlyOnceWith(secondary, {
        surface: 'session.drain.cleanup',
      });
    } finally {
      cleanupThrows = false;
      report.mockRestore();
      await executor.close();
    }
  }
);

test.each([undefined, null, { reason: 'opaque' }])(
  'aborted native admission retains the original opaque cause %j',
  async (cause) => {
    const failures: (ExecutorFailure | undefined)[] = [];
    let fenced = 0;
    const executor = createExecutor({
      beforeConsume: () => fenced++,
      afterDrain: (failure) => failures.push(failure),
    });
    try {
      let caught = false;
      try {
        executor.runSync(() => {
          throw cause;
        });
      } catch (error) {
        caught = true;
        expect(error).toBe(cause);
      }
      expect(caught).toBe(true);
      expect(fenced).toBe(0);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual({ error: cause });
      executor.runSync(() => executor.session.tick(executor.now(), Date.now()));
      expect(fenced).toBe(1);
      expect(failures).toHaveLength(2);
      expect(failures[1]).toBeUndefined();
    } finally {
      await executor.close();
    }
  }
);
