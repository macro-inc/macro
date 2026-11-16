/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { locks } from 'node:worker_threads';
import {
  ABI_MAJOR,
  Access,
  CommandCode,
  EditorInputMsg,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import type {
  ExecutorOptions,
  ExecutorSettlement,
} from '@macro-inc/collaboration/session/executor';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { Flag } from '@macro-inc/collaboration/session/output';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { mountSessionView } from '../session-view';
import { createViewCommand } from './commands';
import type {
  LatestPublishedObserver,
  LatestPublishedUnavailable,
} from './latest-published';
import { createBuiltinRegistry } from './node-views/builtins';
import { registerMacroElementViews } from './node-views/macro';
import type { NodeViewRegistry } from './registry';

const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
beforeAll(() => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: locks,
  });
  native.initSync({
    module: readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm_bg.wasm'
      )
    ),
  });
});
afterAll(() => {
  if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});

function mount(
  observers: readonly LatestPublishedObserver[],
  hooks: Pick<
    ExecutorOptions<EditorSession>,
    'beforeConsume' | 'afterDrain'
  > & {
    commands?: boolean;
    registry?: NodeViewRegistry;
    onError?: (error: unknown) => void;
  } = {}
) {
  const root = document.createElement('div');
  document.body.append(root);
  const owner = crypto.randomUUID();
  const doc = `local-${owner}`;
  const span = Telemetry.span('latest-published-test');
  const telemetry = new SessionTelemetry(span);
  const runtime = mountSessionView(
    root,
    hooks.registry ?? registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'latest-published',
      theme: {},
      editable: true,
      preset: 'rich',
      onError(error) {
        if (hooks.onError) hooks.onError(error);
        else throw error;
      },
    },
    {
      doc,
      owner,
      user: '',
      create: (now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          SessionConfigMsg.encode({
            doc,
            session: owner,
            user: '',
            peers: [7n, 8n, 9n, 10n],
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
          wall,
          'latest-published'
        ),
      auth: {
        async token() {
          throw new Error('Local fixture has no authorization server');
        },
        subscribe: () => () => {},
      },
      socketUrl() {
        throw new Error('Local fixture has no socket');
      },
      telemetry,
      beforeConsume: hooks.beforeConsume,
      afterDrain: hooks.afterDrain,
    },
    hooks.commands === false ? undefined : native,
    observers
  );
  runtime.executor.run(() =>
    runtime.executor.session.input(
      SessionInputMsg.encode(emptyInput(1)),
      runtime.executor.now(),
      Date.now()
    )
  );
  return {
    ...runtime,
    root,
    async close() {
      try {
        await runtime.close();
      } finally {
        root.remove();
        telemetry.close();
        span.end();
      }
    },
  };
}

const documentState = (text: string) =>
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: [
        {
          type: 'paragraph',
          version: 1,
          children: [{ type: 'text', version: 1, text }],
        },
      ],
    },
  });

function recorder() {
  const texts: string[] = [];
  const failures: LatestPublishedUnavailable[] = [];
  let retired = 0;
  const observer: LatestPublishedObserver = {
    published(view) {
      texts.push(view.root.textContent ?? '');
    },
    unavailable(reason) {
      failures.push(reason);
    },
    retired() {
      retired++;
    },
  };
  return { observer, texts, failures, retired: () => retired };
}

const escapeCommand = createViewCommand(
  'Key(Escape)',
  (value): value is KeyboardEvent | null =>
    value === null || value instanceof KeyboardEvent
);

test('latest observation follows actual FIFO publication, not an intermediate onCommit', async () => {
  const observed = recorder();
  const runtime = mount([observed.observer]);
  try {
    observed.texts.length = 0;
    let queued = false;
    const stop = runtime.view.onCommit(() => {
      if (!queued && runtime.root.textContent === 'first') {
        queued = true;
        runtime.port.setState(documentState('last'));
      }
    });
    runtime.port.setState(documentState('first'));
    expect(observed.texts).toEqual(['last']);
    expect(observed.failures).toEqual([]);
    stop();
  } finally {
    await runtime.close();
  }
  expect(observed.retired()).toBe(1);
});

test('first actual edit includes metadata followup at the latest presentation boundary', async () => {
  const roots: string[] = [];
  const runtime = mount([
    {
      published(view) {
        roots.push(view.query.metadata().text);
      },
      unavailable() {},
      retired() {},
    },
  ]);
  try {
    runtime.port.selectionFromView({
      kind: 'range',
      anchor: { key: 0, offset: 0, type: 'element' },
      focus: { key: 0, offset: 0, type: 'element' },
    });
    roots.length = 0;
    expect(
      runtime.port.command(CommandCode.InsertText, 0, 0, 'First edit')
    ).toBe(true);
    expect(runtime.root.textContent).toBe('First edit');
    expect(roots).toHaveLength(1);
    expect(roots[0]).toContain('"documentMetadata":{"version":11}');
  } finally {
    await runtime.close();
  }
});

test('a real handled no-diff key entry notifies without inventing a commit', async () => {
  const observed = recorder();
  const runtime = mount([observed.observer]);
  try {
    observed.texts.length = 0;
    let commits = 0;
    const stop = runtime.view.onCommit(() => commits++);
    const release = runtime.view.registerViewCommand(
      escapeCommand,
      () => true,
      3
    );
    expect(runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(commits).toBe(0);
    expect(observed.texts).toEqual(['']);
    expect(observed.failures).toEqual([]);
    release();
    stop();
  } finally {
    await runtime.close();
  }
});

for (const commands of [false, true]) {
  test(`partial DOM apply retires observation despite successful recovery, commands=${commands}`, async () => {
    const observed = recorder();
    const registry = registerMacroElementViews(createBuiltinRegistry());
    const paragraph = registry.get('paragraph');
    const cause = { kind: 'actual renderer failure' };
    let fail = false;
    registry.replace('paragraph', {
      ...paragraph,
      createDOM(node, context) {
        if (fail) {
          fail = false;
          throw cause;
        }
        return paragraph.createDOM(node, context);
      },
    });
    const reports: unknown[] = [];
    const runtime = mount([observed.observer], {
      commands,
      registry,
      onError: (error) => reports.push(error),
    });
    try {
      observed.texts.length = 0;
      fail = true;
      runtime.port.setState(documentState('recovered'));
      expect(runtime.root.textContent).toBe('recovered');
      expect(reports).toContain(cause);
      expect(observed.texts).toEqual([]);
      expect(observed.failures).toEqual([
        { kind: 'apply', failure: { error: cause } },
      ]);
      expect(observed.retired()).toBe(1);
      runtime.port.setState(documentState('later'));
      expect(observed.texts).toEqual([]);
    } finally {
      await runtime.close();
    }
    expect(observed.retired()).toBe(1);
  });
}

test('a successful reentrant drain cannot erase the enclosing cleanup failure', async () => {
  const observed = recorder();
  const cause = { kind: 'outer cleanup' };
  let armed = false;
  const runtime = mount([observed.observer], {
    afterDrain() {
      if (!armed) return;
      armed = false;
      runtime.port.setState(documentState('inner success'));
      throw cause;
    },
  });
  try {
    observed.texts.length = 0;
    armed = true;
    expect(() => runtime.port.setState(documentState('outer'))).toThrow(cause);
    expect(runtime.root.textContent).toBe('inner success');
    expect(observed.texts).toEqual([]);
    expect(observed.failures).toEqual([
      { kind: 'cleanup', failure: { error: cause } },
    ]);
    expect(observed.retired()).toBe(1);
  } finally {
    await runtime.close();
  }
});

for (const cause of [undefined, null, { kind: 'original drain' }]) {
  test(`inherited drain failure keeps its original value ${String(cause)}`, async () => {
    const observed = recorder();
    let armed = false;
    const runtime = mount([observed.observer], {
      afterDrain() {
        if (armed) throw cause;
      },
    });
    try {
      observed.texts.length = 0;
      armed = true;
      let result: ExecutorSettlement | undefined;
      let thrown: { error: unknown } | undefined;
      try {
        runtime.executor.runSettled(
          () =>
            runtime.executor.session.input(
              SessionInputMsg.encode({
                ...emptyInput(2),
                editor: EditorInputMsg.fromEditorSetState({
                  json: documentState('committed'),
                }),
              }),
              runtime.executor.now(),
              Date.now()
            ),
          (value) => {
            result = value;
          }
        );
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toEqual({ error: cause });
      expect(result).toEqual({ status: 'error', error: cause });
      expect(observed.texts).toEqual([]);
      expect(observed.failures).toEqual([
        { kind: 'cleanup', failure: { error: cause } },
      ]);
      expect(observed.retired()).toBe(1);
      armed = false;
      // This completed model write remains real; only the prior cleanup failed.
      let nextResult: ExecutorSettlement | undefined;
      runtime.executor.runSettled(
        () =>
          runtime.executor.session.input(
            SessionInputMsg.encode({
              ...emptyInput(2),
              editor: EditorInputMsg.fromEditorSetState({
                json: documentState('next healthy'),
              }),
            }),
            runtime.executor.now(),
            Date.now()
          ),
        (value) => {
          nextResult = value;
        }
      );
      expect(nextResult).toMatchObject({ status: 'success' });
      expect(runtime.root.textContent).toBe('next healthy');
      expect(observed.texts).toEqual([]);
      expect(observed.failures).toEqual([
        { kind: 'cleanup', failure: { error: cause } },
      ]);
      expect(observed.retired()).toBe(1);
    } finally {
      armed = false;
      await runtime.close();
    }
  });
}

test('observer failures are secondary and cleanup runs once without failing the real input', async () => {
  const cause = undefined;
  let armed = false,
    cleaned = 0;
  const failures: LatestPublishedUnavailable[] = [];
  const healthy = recorder();
  const runtime = mount([
    {
      published() {
        if (armed) throw cause;
      },
      unavailable(reason) {
        failures.push(reason);
        throw null;
      },
      retired() {
        cleaned++;
        throw { kind: 'secondary cleanup' };
      },
    },
    healthy.observer,
  ]);
  const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {
    throw new Error('reporter');
  });
  try {
    healthy.texts.length = 0;
    armed = true;
    expect(
      await runtime.port.inputSettled(
        EditorInputMsg.fromEditorSetState({ json: documentState('success') })
      )
    ).toEqual({ status: 'success', handled: false });
    expect(runtime.root.textContent).toBe('success');
    expect(failures).toEqual([
      { kind: 'observer', failure: { error: undefined } },
    ]);
    expect(cleaned).toBe(1);
    expect(healthy.texts).toEqual(['success']);
  } finally {
    await runtime.close();
    report.mockRestore();
  }
  expect(cleaned).toBe(1);
});

test('direct view disposal retires observers immediately with no extra native output', async () => {
  const observed = recorder();
  const runtime = mount([observed.observer]);
  try {
    observed.texts.length = 0;
    const before = runtime.executor.session.takeOutput();
    runtime.view.dispose();
    expect(observed.retired()).toBe(1);
    expect(observed.texts).toEqual([]);
    expect(runtime.executor.session.takeOutput()).toEqual(before);
    runtime.view.dispose();
    expect(observed.retired()).toBe(1);
  } finally {
    await runtime.close();
  }
});

test('construction snapshots observers and never invokes an appended observer', async () => {
  const first = recorder();
  const late = recorder();
  const observers = [first.observer];
  const runtime = mount(observers);
  try {
    observers.push(late.observer);
    first.texts.length = 0;
    runtime.port.setState(documentState('snapshot'));
    expect(first.texts).toEqual(['snapshot']);
    expect(late.texts).toEqual([]);
  } finally {
    await runtime.close();
  }
  expect(first.retired()).toBe(1);
  expect(late.retired()).toBe(0);
});

test('actual native callback error flags retire presentation even when the reporter returns', async () => {
  const observed = recorder();
  const flags: number[] = [];
  const runtime = mount([observed.observer], {
    beforeConsume(value) {
      flags.push(value);
    },
    onError() {},
  });
  const cause = { kind: 'actual callback failure' };
  try {
    const release = runtime.view.registerViewCommand(
      escapeCommand,
      () => {
        throw cause;
      },
      3
    );
    observed.texts.length = 0;
    flags.length = 0;
    let thrown: { error: unknown } | undefined;
    try {
      runtime.port.nativeEscape?.dispatch();
    } catch (error) {
      thrown = { error };
    }
    expect(thrown).toEqual({ error: cause });
    expect(flags.some((value) => Boolean(value & Flag.Error))).toBe(true);
    expect(observed.texts).toEqual([]);
    expect(observed.failures).toHaveLength(1);
    expect(observed.retired()).toBe(1);
    release();
  } finally {
    await runtime.close();
  }
});

test('observer reentry retires that observer and refreshes others against the new generation', async () => {
  let armed = false;
  const failures: LatestPublishedUnavailable[] = [];
  let cleaned = 0;
  const healthy = recorder();
  const runtime = mount([
    {
      published(view) {
        if (armed) view.port.setState(documentState('reentered'));
      },
      unavailable(reason) {
        failures.push(reason);
      },
      retired() {
        cleaned++;
      },
    },
    healthy.observer,
  ]);
  try {
    healthy.texts.length = 0;
    armed = true;
    runtime.port.setState(documentState('outer'));
    expect(failures).toEqual([{ kind: 'observer-reentry' }]);
    expect(cleaned).toBe(1);
    expect(healthy.texts).toEqual(['reentered']);
    expect(runtime.root.textContent).toBe('reentered');
  } finally {
    await runtime.close();
  }
});

test('an observer closing the view prevents later observers from reading it', async () => {
  let armed = false;
  let close: (() => Promise<void>) | undefined;
  let closing: Promise<void> | undefined;
  const later = recorder();
  const runtime = mount([
    {
      published() {
        if (armed) closing = close?.();
      },
      unavailable() {},
      retired() {},
    },
    later.observer,
  ]);
  close = runtime.close;
  try {
    later.texts.length = 0;
    armed = true;
    runtime.port.setState(documentState('closing'));
    expect(later.texts).toEqual([]);
    expect(later.retired()).toBe(1);
    if (!closing) throw new Error('Observer did not close the actual view');
    await closing;
  } finally {
    await runtime.close();
  }
});

for (const cause of [undefined, null]) {
  test(`early and late terminal failures stay secondary ${String(cause)}`, async () => {
    const runtime = mount([]);
    let cleaned = 0;
    const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {
      throw { kind: 'secondary reporter' };
    });
    try {
      runtime.view.onTeardown(() => {
        throw cause;
      });
      runtime.view.onTeardown(() => {
        cleaned++;
      });
      expect(() => runtime.view.dispose()).not.toThrow();
      expect(() =>
        runtime.view.onTeardown(() => {
          throw cause;
        })
      ).not.toThrow();
      expect(cleaned).toBe(1);
    } finally {
      await runtime.close();
      report.mockRestore();
    }
  });
}

test('teardown snapshots listeners, handles late registration and reentrant disposal once', async () => {
  const runtime = mount([]);
  const calls: string[] = [];
  let remove = () => {};
  try {
    runtime.view.onTeardown(() => {
      calls.push('first');
      remove();
      runtime.view.onTeardown(() => calls.push('late'));
      runtime.view.dispose();
    });
    remove = runtime.view.onTeardown(() => calls.push('second'));
    runtime.view.beginTeardown();
    runtime.view.dispose();
    expect(calls).toEqual(['first', 'late', 'second']);
  } finally {
    await runtime.close();
  }
});

test('closing inside the real Escape callback retires without replacing its opaque primary', async () => {
  const observed = recorder();
  const runtime = mount([observed.observer]);
  const cause = { kind: 'actual callback primary' };
  let closing: Promise<void> | undefined;
  let thrown: { error: unknown } | undefined;
  runtime.view.registerViewCommand(
    escapeCommand,
    () => {
      closing = runtime.close();
      expect(observed.retired()).toBe(1);
      throw cause;
    },
    3
  );
  try {
    observed.texts.length = 0;
    try {
      runtime.port.nativeEscape?.dispatch();
    } catch (error) {
      thrown = { error };
    }
    expect(thrown).toEqual({ error: cause });
    if (!closing) throw new Error('Callback did not request close');
    await closing;
    expect(observed.texts).toEqual([]);
    expect(() => runtime.executor.session.effectiveAccess()).toThrow();
  } finally {
    await runtime.close();
  }
});

for (const lane of ['close', 'direct-dispose']) {
  test(`terminal observer cannot admit ordinary command input during ${lane}`, async () => {
    const attempted: unknown[] = [];
    const attemptEntries: number[] = [];
    let entries = 0;
    let armed = false;
    let mutate: (() => void) | undefined;
    const runtime = mount(
      [
        {
          published() {},
          unavailable() {},
          retired() {
            const before = entries;
            try {
              mutate?.();
            } catch (error) {
              attempted.push(error);
            } finally {
              attemptEntries.push(entries - before);
            }
          },
        },
      ],
      {
        beforeConsume() {
          if (armed) entries++;
        },
      }
    );
    runtime.port.setState(documentState('before retirement'));
    armed = true;
    mutate = () =>
      runtime.port.setState(documentState('forbidden retirement input'));
    try {
      if (lane === 'close') await runtime.close();
      else runtime.view.dispose();
      expect(attempted).toHaveLength(1);
      expect(attempted[0]).toEqual(new Error('Native editor view is closing'));
      expect(attemptEntries).toEqual([0]);
    } finally {
      await runtime.close();
    }
  });
}

test('a retired no-command view has no DOM input route', async () => {
  let entries = 0;
  let armed = false;
  const runtime = mount([], {
    commands: false,
    beforeConsume() {
      if (armed) entries++;
    },
  });
  try {
    runtime.port.setState(documentState('retained no-command state'));
    const before = runtime.view.query.serializedState();
    runtime.view.dispose();
    armed = true;
    runtime.root.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
        cancelable: true,
      })
    );
    runtime.root.dispatchEvent(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'forbidden',
        bubbles: true,
        cancelable: true,
      })
    );
    expect(entries).toBe(0);
    expect(runtime.view.query.serializedState()).toBe(before);
  } finally {
    await runtime.close();
  }
});
