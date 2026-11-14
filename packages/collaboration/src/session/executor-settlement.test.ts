import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { locks } from 'node:worker_threads';
import { NOOP_SPAN } from '@macro-inc/observability';
import { beforeAll, expect, test } from 'vitest';
import {
  EditorSession,
  initSync,
} from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  EditorInputMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from './abi.generated';
import {
  type ExecutorOptions,
  type ExecutorSettlement,
  SessionExecutor,
} from './executor';
import { emptyInput } from './input';
import { SessionTelemetry } from './telemetry';

beforeAll(() =>
  initSync({
    module: readFileSync(
      new URL(
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm',
        import.meta.url
      )
    ),
  })
);
function setup(
  hooks: Pick<
    ExecutorOptions<EditorSession>,
    'beforeConsume' | 'afterDrain' | 'view'
  > = { view: { apply() {} } }
) {
  const doc = `settlement-${crypto.randomUUID()}`;
  const owner = crypto.randomUUID();
  const executor = new SessionExecutor({
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
        throw new Error('No transport');
      },
      subscribe: () => () => {},
    },
    socketUrl: () => {
      throw new Error('No transport');
    },
    telemetry: new SessionTelemetry(NOOP_SPAN),
  });
  executor.start();
  executor.run(() =>
    executor.session.input(
      SessionInputMsg.encode(emptyInput(1)),
      executor.now(),
      Date.now()
    )
  );
  return executor;
}

for (const cause of [undefined, null, { reason: 'opaque input' }]) {
  test(`queued settlement preserves FIFO and own opaque ${String(cause)} error`, async () => {
    const executor = setup();
    const seen: string[] = [];
    const results: ExecutorSettlement[] = [];
    let caught: { error: unknown } | undefined;
    try {
      try {
        executor.run(() => {
          executor.runSettled(
            () => {
              seen.push('first');
              return executor.session.tick(executor.now(), Date.now());
            },
            (result) => results.push(result)
          );
          executor.runSettled(
            () => {
              seen.push('failing');
              throw cause;
            },
            (result) => results.push(result)
          );
          executor.runSettled(
            () => {
              seen.push('later');
              return executor.session.tick(executor.now(), Date.now());
            },
            (result) => results.push(result)
          );
          expect(results).toEqual([]);
          return executor.session.tick(executor.now(), Date.now());
        });
      } catch (error) {
        caught = { error };
      }
      expect(caught).toBeDefined();
      expect(caught?.error).toBe(cause);
      expect(seen).toEqual(['first', 'failing']);
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('success');
      expect(results[1]).toEqual({ status: 'error', error: cause });
      executor.run(() => executor.session.tick(executor.now(), Date.now()));
      expect(seen).toEqual(['first', 'failing', 'later']);
      expect(results).toHaveLength(3);
      expect(results[2].status).toBe('success');
    } finally {
      await executor.close();
    }
  });
}

test('settlement observes before-consume failure and runs after the unlocked outer drain', async () => {
  const cause = { reason: 'before consume' };
  let armed = false;
  let drained = false;
  const executor = setup({
    beforeConsume() {
      if (armed) throw cause;
    },
    afterDrain() {
      drained = true;
    },
    view: { apply() {} },
  });
  try {
    drained = false;
    armed = true;
    const results: ExecutorSettlement[] = [];
    expect(() =>
      executor.runSettled(
        () => executor.session.tick(executor.now(), Date.now()),
        (result) => {
          expect(drained).toBe(true);
          results.push(result);
        }
      )
    ).toThrow(cause);
    expect(results).toEqual([{ status: 'error', error: cause }]);
    armed = false;
    executor.runSettled(
      () => executor.session.tick(executor.now(), Date.now()),
      (result) => {
        expect(result.status).toBe('success');
        executor.runSync(() =>
          executor.session.tick(executor.now(), Date.now())
        );
      }
    );
  } finally {
    armed = false;
    await executor.close();
  }
});

test('real native failure flags never masquerade as successful unhandled completion', async () => {
  const executor = setup();
  executor.run(() =>
    executor.session.authorization(
      true,
      false,
      false,
      executor.now(),
      Date.now()
    )
  );
  const results: ExecutorSettlement[] = [];
  try {
    executor.runSettled(
      () =>
        executor.session.input(
          SessionInputMsg.encode({
            ...emptyInput(2),
            editor: EditorInputMsg.fromEditorSetState({
              json: JSON.stringify({
                root: { type: 'root', version: 1, children: [] },
              }),
            }),
          }),
          executor.now(),
          Date.now()
        ),
      (result) => results.push(result)
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('error');
  } finally {
    await executor.close();
  }
});

test('closed admission cancels once without invoking the actual freed native receiver', async () => {
  const executor = setup();
  await executor.close();
  let calls = 0;
  const results: ExecutorSettlement[] = [];
  executor.runSettled(
    () => {
      calls++;
      return executor.session.tick(executor.now(), Date.now());
    },
    (result) => results.push(result)
  );
  expect(calls).toBe(0);
  expect(results).toEqual([{ status: 'cancelled', reason: 'closed' }]);
});

test('consume and unowned drain errors settle the actual pending fence with original identity', async () => {
  for (const stage of ['consume', 'drain']) {
    const cause = { stage };
    let armed = false;
    const executor = setup({
      view: {
        apply() {
          if (armed && stage === 'consume') throw cause;
        },
      },
      afterDrain() {
        if (armed && stage === 'drain') throw cause;
      },
    });
    const results: ExecutorSettlement[] = [];
    try {
      armed = true;
      expect(() =>
        executor.runSettled(
          () =>
            executor.session.input(
              SessionInputMsg.encode({
                ...emptyInput(2),
                editor: EditorInputMsg.fromEditorSetState({
                  json: JSON.stringify({
                    root: {
                      type: 'root',
                      version: 1,
                      children: [
                        { type: 'paragraph', version: 1, children: [] },
                      ],
                    },
                  }),
                }),
              }),
              executor.now(),
              Date.now()
            ),
          (result) => results.push(result)
        )
      ).toThrow(cause);
      expect(results).toEqual([{ status: 'error', error: cause }]);
    } finally {
      armed = false;
      await executor.close();
    }
  }
});

test('close failure cancels only never-started accepted settlements at the final closed fence', async () => {
  const first = { reason: 'outer' };
  const second = { reason: 'close' };
  let closing: Promise<void> | undefined;
  const executor = setup({
    view: { apply() {} },
    afterDrain(failure) {
      if (failure && !closing) closing = executor.close();
    },
  });
  const results: ExecutorSettlement[] = [];
  let called = false;
  let admissionReads = 0;
  let callerReads = 0;
  expect(() =>
    executor.run(() => {
      executor.run(() => {
        throw first;
      });
      executor.run(() => {
        throw second;
      });
      executor.runSettled(
        () => {
          called = true;
          return executor.session.tick(executor.now(), Date.now());
        },
        (result) => results.push(result),
        {
          admit() {
            admissionReads++;
            return true;
          },
          admitEntry() {
            callerReads++;
            return true;
          },
        }
      );
      return executor.session.tick(executor.now(), Date.now());
    })
  ).toThrow(first);
  if (!closing) throw new Error('Missing actual close');
  await expect(closing).rejects.toBe(second);
  expect(called).toBe(false);
  expect(admissionReads).toBe(0);
  expect(callerReads).toBe(0);
  expect(results).toEqual([{ status: 'cancelled', reason: 'closed' }]);
});

for (const canComment of [false, true]) {
  test(`queued authority refusal cancels without materializing an application (${canComment})`, async () => {
    const executor = setup();
    const results: ExecutorSettlement[] = [];
    let authorityReads = 0;
    let applications = 0;
    let after = 0;
    try {
      executor.run(() => {
        executor.runSettled(
          () => {
            applications++;
            return executor.session.input(
              SessionInputMsg.encode({
                ...emptyInput(2),
                editor: EditorInputMsg.fromEditorApplication({
                  name: 'group-b.equation',
                  json: '{"key":0,"equation":"x"}',
                  generation: 0,
                  selection: {
                    kind: 0,
                    anchor: { key: 0, offset: 0, type: 0 },
                    focus: { key: 0, offset: 0, type: 0 },
                    nodes: [],
                    table: 0,
                    dirty: false,
                  },
                  keyboard: false,
                  key: '',
                  code: 0,
                  mods: 0,
                }),
              }),
              executor.now(),
              Date.now()
            );
          },
          (result) => results.push(result),
          {
            admit() {
              authorityReads++;
              return executor.session.effectiveAccess() === Access.Edit;
            },
            after() {
              after++;
            },
          }
        );
        return executor.session.authorization(
          true,
          false,
          canComment,
          executor.now(),
          Date.now()
        );
      });
      expect(results).toEqual([
        { status: 'cancelled', reason: 'session-access' },
      ]);
      expect(authorityReads).toBe(1);
      expect(applications).toBe(0);
      expect(after).toBe(0);
    } finally {
      await executor.close();
    }
  });
}

test('cancelled admission still drains unlocked cleanup and preserves its cancellation on cleanup failure', async () => {
  const cause = { reason: 'cleanup after refusal' };
  const seen: string[] = [];
  let armed = false;
  let executor: SessionExecutor<EditorSession>;
  executor = setup({
    view: { apply() {} },
    afterDrain() {
      if (!armed) return;
      armed = false;
      seen.push('drain');
      executor.runSync(() => executor.session.tick(executor.now(), Date.now()));
      throw cause;
    },
  });
  const results: ExecutorSettlement[] = [];
  try {
    armed = true;
    expect(() =>
      executor.runSettled(
        () => {
          throw new Error('Refused call must not execute');
        },
        (result) => {
          seen.push('settlement');
          results.push(result);
        },
        {
          admit: () => false,
          after() {
            throw new Error('Refused after must not execute');
          },
        }
      )
    ).toThrow(cause);
    expect(seen).toEqual(['drain', 'settlement']);
    expect(results).toEqual([
      { status: 'cancelled', reason: 'session-access' },
    ]);
  } finally {
    armed = false;
    await executor.close();
  }
});

test('caller cancellation preserves exact reason through unrelated unlocked drain failure', async () => {
  const cause = { reason: 'entry cleanup' };
  const order: string[] = [];
  let armed = false;
  let executor: SessionExecutor<EditorSession>;
  executor = setup({
    view: { apply() {} },
    beforeConsume() {
      if (armed) order.push('consume');
    },
    afterDrain() {
      if (!armed) return;
      armed = false;
      order.push('drain');
      executor.runSync(() => executor.session.tick(executor.now(), Date.now()));
      throw cause;
    },
  });
  const results: ExecutorSettlement[] = [];
  try {
    armed = true;
    const options = {
      admit: () => {
        order.push('authority');
        return true;
      },
      admitEntry: () => {
        order.push('caller');
        return false;
      },
      after() {
        order.push('after');
      },
    };
    expect(() =>
      executor.runSettled(
        () => {
          throw new Error('Cancelled call must not run');
        },
        (result) => {
          order.push('notify');
          results.push(result);
        },
        options
      )
    ).toThrow(cause);
    expect(order).toEqual(['authority', 'caller', 'drain', 'notify']);
    expect(results).toEqual([
      { status: 'cancelled', reason: 'entry-admission' },
    ]);
  } finally {
    armed = false;
    await executor.close();
  }
});

const invalidThenable = Object.defineProperty({}, 'then', {
  get() {
    throw new Error('Must not inspect then');
  },
});
for (const { label, value } of [
  { label: '[object Undefined]', value: undefined },
  { label: '[object Null]', value: null },
  { label: 'plain object', value: {} },
  { label: '[object Promise]', value: Promise.resolve(true) },
  { label: 'invalid thenable', value: invalidThenable },
]) {
  test(`caller admission rejects non-boolean ${label} without materialization`, async () => {
    const executor = setup();
    const results: ExecutorSettlement[] = [];
    let calls = 0;
    const options = { admitEntry: () => true };
    Object.defineProperty(options, 'admitEntry', { value: () => value });
    try {
      expect(() =>
        executor.runSettled(
          () => {
            calls++;
            return executor.session.tick(executor.now(), Date.now());
          },
          (result) => results.push(result),
          options
        )
      ).toThrow(TypeError);
      expect(calls).toBe(0);
      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result?.status).toBe('error');
      if (result?.status !== 'error')
        throw new Error('Expected invalid-return error');
      expect(result.error).toBeInstanceOf(TypeError);
    } finally {
      await executor.close();
    }
  });
}

for (const cause of [undefined, null, { reason: 'caller predicate' }]) {
  test(`caller predicate preserves opaque ${String(cause)} and remaining FIFO`, async () => {
    const executor = setup();
    const results: ExecutorSettlement[] = [];
    const order: string[] = [];
    const options = {
      admitEntry() {
        order.push('predicate');
        throw cause;
      },
    };
    let caught: { error: unknown } | undefined;
    try {
      try {
        executor.run(() => {
          executor.runSettled(
            () => {
              throw new Error('Failed predicate factory must not run');
            },
            (result) => results.push(result),
            options
          );
          executor.run(() => {
            order.push('remaining');
            return executor.session.tick(executor.now(), Date.now());
          });
          return executor.session.tick(executor.now(), Date.now());
        });
      } catch (error) {
        caught = { error };
      }
      expect(caught).toBeDefined();
      expect(caught?.error).toBe(cause);
      expect(results).toEqual([{ status: 'error', error: cause }]);
      expect(order).toEqual(['predicate']);
      executor.run(() => executor.session.tick(executor.now(), Date.now()));
      expect(order).toEqual(['predicate', 'remaining']);
    } finally {
      await executor.close();
    }
  });
}
