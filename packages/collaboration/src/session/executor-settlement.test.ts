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
        (result) => results.push(result)
      );
      return executor.session.tick(executor.now(), Date.now());
    })
  ).toThrow(first);
  if (!closing) throw new Error('Missing actual close');
  await expect(closing).rejects.toBe(second);
  expect(called).toBe(false);
  expect(results).toEqual([{ status: 'cancelled', reason: 'closed' }]);
});
