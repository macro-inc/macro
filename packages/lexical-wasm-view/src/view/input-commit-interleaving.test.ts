/** @vitest-environment jsdom */
import { writeFileSync } from 'node:fs';
import {
  EditorInputMsg,
  SessionInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { createInputCommitObservation } from './input-commit-observation';
import {
  commitApplication,
  encodedCommitApplication,
  initializeInputCommitFixture,
  mountInputCommitFixture,
  native,
  rejectedInputCommitAttempt,
  seedInputCommitFixture,
} from './input-commit-test-fixture';
import { NativeEnterDispatcher } from './native-enter';
import { SessionPort } from './session-port';

let restore: (() => void) | undefined;
const records: unknown[] = [];
beforeAll(() => {
  restore = initializeInputCommitFixture();
});
afterAll(() => {
  restore?.();
  if (process.env.INPUT_COMMIT_INTERLEAVING_PROOF)
    writeFileSync(
      process.env.INPUT_COMMIT_INTERLEAVING_PROOF,
      JSON.stringify(
        records,
        (_, value) => (typeof value === 'bigint' ? `${value}` : value),
        2
      )
    );
});

test('direct guarded Published id1 cannot become the following failed Port entry receipt', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    runtime.executor.run(() =>
      runtime.executor.session.inputObserved(
        encodedCommitApplication(runtime),
        runtime.executor.now(),
        Date.now(),
        '1'
      )
    );
    const raw = runtime.executor.session.readInputCommitReceipt('1');
    try {
      expect(raw.mainKind).toBe(native.InputCommitKind.Published);
      expect(raw.mainHandled).toBe(true);
    } finally {
      raw.free();
    }
    const observed = createInputCommitObservation();
    let caught: { error: unknown } | undefined;
    try {
      await runtime.port.inputSettled(
        () => commitApplication(runtime, 'not JSON'),
        { mainCommit: observed }
      );
    } catch (error) {
      caught = { error };
    }
    expect(caught).toBeDefined();
    const state = observed.read();
    records.push({
      control: 'raw-published-then-failed-Port',
      state,
      caught: caught !== undefined,
      model: runtime.executor.session.serializedState(),
    });
    expect(state.status).toBe('not-published');
    if (state.status !== 'not-published')
      throw new Error('Expected exact native NoPub');
    expect(state.entryId).toBeGreaterThan(1n);
    expect(runtime.executor.session.serializedState()).toContain('"format":1');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('queued gap and a factory throwing native attempt both advance the same actual receiver', async () => {
  const runtime = mountInputCommitFixture();
  let pending: ReturnType<typeof runtime.port.inputSettled> | undefined;
  const observed = createInputCommitObservation();
  try {
    await seedInputCommitFixture(runtime);
    runtime.executor.run(() => {
      pending = runtime.port.inputSettled(
        () => {
          rejectedInputCommitAttempt(runtime, '100');
          return commitApplication(runtime);
        },
        { mainCommit: observed }
      );
      rejectedInputCommitAttempt(runtime, '50');
      return runtime.executor.session.tick(runtime.executor.now(), Date.now());
    });
    expect(await pending).toMatchObject({ status: 'success', handled: true });
    const state = observed.read();
    if (state.status !== 'published')
      throw new Error('Expected actual Published');
    expect(state.entryId).toBeGreaterThan(100n);
    expect(runtime.executor.session.serializedState()).toContain('"format":1');
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('clock reentry can encode another actual input without corrupting owned outer bytes', async () => {
  const runtime = mountInputCommitFixture();
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    await seedInputCommitFixture(runtime);
    const originalNow = runtime.executor.now;
    let reentered = false;
    clock = vi.spyOn(runtime.executor, 'now').mockImplementation(() => {
      if (!reentered) {
        reentered = true;
        SessionInputMsg.encode({
          ...emptyInput(2),
          editor: EditorInputMsg.fromEditorSetState({
            json: JSON.stringify({
              root: {
                type: 'root',
                version: 1,
                children: [],
              },
            }),
          }),
        });
        rejectedInputCommitAttempt(runtime, '200');
      }
      return originalNow();
    });
    const observed = createInputCommitObservation();
    const result = await runtime.port.inputSettled(
      () => commitApplication(runtime),
      { mainCommit: observed }
    );
    expect(result).toMatchObject({ status: 'success', handled: true });
    expect(reentered).toBe(true);
    const copied = observed.read();
    expect(copied.status).toBe('published');
    if (copied.status !== 'published')
      throw new Error('Expected actual main receipt');
    expect(copied.entryId).toBeGreaterThan(200n);
    const model = runtime.executor.session.serializedState();
    expect(model).toContain('commit');
    expect(model).toContain('"format":1');
  } finally {
    clock?.mockRestore();
    await runtime.close();
    runtime.root.remove();
  }
});

for (const boundary of ['before queue', 'queued', 'factory', 'clock']) {
  test(`a different already-bound owner at ${boundary} never receives this Port input`, async () => {
    const first = mountInputCommitFixture();
    const other = mountInputCommitFixture();
    const descriptor = Object.getOwnPropertyDescriptor(
      first.executor,
      'session'
    );
    if (!descriptor)
      throw new Error('Missing actual executor receiver descriptor');
    const original = first.executor.session;
    const replace = () =>
      Object.defineProperty(first.executor, 'session', {
        ...descriptor,
        value: other.executor.session,
      });
    const observed = createInputCommitObservation();
    let calls = 0;
    let pending: ReturnType<typeof first.port.inputSettled> | undefined;
    let clock: ReturnType<typeof vi.spyOn> | undefined;
    let caught: { error: unknown } | undefined;
    try {
      await seedInputCommitFixture(first);
      await seedInputCommitFixture(other);
      const firstBefore = original.serializedState();
      const otherBefore = other.executor.session.serializedState();
      const factory = () => {
        calls++;
        if (boundary === 'factory') replace();
        return commitApplication(first);
      };
      if (boundary === 'before queue') replace();
      if (boundary === 'clock') {
        const now = first.executor.now;
        clock = vi.spyOn(first.executor, 'now').mockImplementation(() => {
          replace();
          return now();
        });
      }
      try {
        if (boundary === 'queued') {
          first.executor.run(() => {
            pending = first.port.inputSettled(factory, {
              mainCommit: observed,
            });
            return original.tick(first.executor.now(), Date.now());
          }, replace);
        } else
          pending = first.port.inputSettled(factory, { mainCommit: observed });
      } catch (error) {
        caught = { error };
      }
      Object.defineProperty(first.executor, 'session', descriptor);
      clock?.mockRestore();
      records.push({
        control: `replacement-${boundary}`,
        caught: caught !== undefined,
        factoryCalls: calls,
        observation: observed.read(),
        firstBefore,
        otherBefore,
        firstAfter: original.serializedState(),
        otherAfter: other.executor.session.serializedState(),
      });
      expect(caught).toBeDefined();
      if (pending) expect(await pending).toMatchObject({ status: 'error' });
      expect(calls).toBe(
        boundary === 'factory' || boundary === 'clock' ? 1 : 0
      );
      expect(observed.read().status).toBe(
        boundary === 'before queue' ? 'unbound' : 'not-entered'
      );
      expect(original.serializedState()).toBe(firstBefore);
      expect(other.executor.session.serializedState()).toBe(otherBefore);
      expect(
        other.port.query({ kind: 3, key: 0, flags: 0, text: '' }).count
      ).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(first.executor, 'session', descriptor);
      clock?.mockRestore();
      await first.close();
      await other.close();
      first.root.remove();
      other.root.remove();
    }
  });
}

test('maximum u64 accepted attempt exhausts observation without wrap or fallback input', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    rejectedInputCommitAttempt(runtime, '18446744073709551615');
    const before = runtime.executor.session.serializedState();
    const observed = createInputCommitObservation();
    let caught: { error: unknown } | undefined;
    try {
      await runtime.port.inputSettled(() => commitApplication(runtime), {
        mainCommit: observed,
      });
    } catch (error) {
      caught = { error };
    }
    expect(caught).toBeDefined();
    expect(observed.read()).toMatchObject({
      status: 'unavailable',
      reason: 'correlation-exhausted',
      receiverNeverCalled: true,
    });
    expect(runtime.executor.session.serializedState()).toBe(before);
    const next = createInputCommitObservation();
    expect(() =>
      runtime.port.inputSettled(() => commitApplication(runtime), {
        mainCommit: next,
      })
    ).toThrow('correlation-exhausted');
    expect(next.read()).toMatchObject({
      status: 'unavailable',
      receiverNeverCalled: true,
    });
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('two real Port wrappers share one actual Session counter, while another Session is independent', async () => {
  const first = mountInputCommitFixture();
  const other = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(first);
    await seedInputCommitFixture(other);
    // Reuse the ACTUAL constructor-owned sink and binding, not stand-in hooks.
    const sink = Reflect.get(first.port, 'view');
    const binding = Reflect.get(first.port, 'commands');
    expect(sink).toBeDefined();
    expect(binding).toBeDefined();
    const secondPort = new SessionPort(
      first.executor,
      sink,
      undefined,
      binding
    );
    const a = createInputCommitObservation();
    const b = createInputCommitObservation();
    const c = createInputCommitObservation();
    await first.port.inputSettled(() => commitApplication(first), {
      mainCommit: a,
    });
    await secondPort.inputSettled(() => commitApplication(first, '"italic"'), {
      mainCommit: b,
    });
    await other.port.inputSettled(() => commitApplication(other), {
      mainCommit: c,
    });
    const firstState = a.read(),
      secondState = b.read(),
      otherState = c.read();
    if (
      firstState.status !== 'published' ||
      secondState.status !== 'published' ||
      otherState.status !== 'published'
    )
      throw new Error('Expected three actual native main commits');
    expect(secondState.entryId).toBeGreaterThan(firstState.entryId);
    expect(otherState.entryId).toBe(1n);
    expect(first.executor.session.serializedState()).toContain('"format":3');
  } finally {
    await first.close();
    await other.close();
    first.root.remove();
    other.root.remove();
  }
});

test('actual unhandled no-op transaction is Published without a document mutation', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    const before = runtime.executor.session.serializedState();
    let notified = 0;
    const observed = createInputCommitObservation(() => {
      notified++;
    });
    const result = await runtime.port.inputSettled(
      () => ({
        ...commitApplication(runtime),
        name: 'group-b.equation',
        json: '{"key":0,"equation":"x"}',
      }),
      { mainCommit: observed }
    );
    expect(result).toMatchObject({
      status: 'success',
      handled: false,
      mainCommit: { status: 'published', mainHandled: false },
    });
    expect(notified).toBe(1);
    expect(runtime.executor.session.serializedState()).toBe(before);
    const copy = observed.read();
    runtime.executor.run(() =>
      runtime.executor.session.tick(runtime.executor.now(), Date.now())
    );
    expect(observed.read()).toBe(copy);
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('actual malformed, equal and decreasing attempts preserve the last native receipt without corrupting issuance', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    const bytes = encodedCommitApplication(runtime);
    runtime.executor.run(() =>
      runtime.executor.session.inputObserved(
        bytes,
        runtime.executor.now(),
        Date.now(),
        '25'
      )
    );
    const model = runtime.executor.session.serializedState();
    for (const id of [
      '',
      '0',
      '01',
      '-1',
      '+1',
      ' 2',
      '1e3',
      '１',
      '18446744073709551616',
      '1',
      '25',
    ]) {
      expect(() =>
        runtime.executor.session.inputObserved(
          bytes,
          runtime.executor.now(),
          Date.now(),
          id
        )
      ).toThrow();
      const receipt = runtime.executor.session.readInputCommitReceipt('25');
      try {
        expect(receipt.entryId).toBe(25n);
        expect(receipt.mainKind).toBe(native.InputCommitKind.Published);
      } finally {
        receipt.free();
      }
      expect(runtime.executor.session.serializedState()).toBe(model);
    }
    let coercions = 0;
    const primitiveOnly = {
      get toString() {
        coercions++;
        return () => '200';
      },
    };
    const guard = NativeEnterDispatcher.forModule(native).guard;
    const token = guard.completedEntryToken();
    expect(() =>
      Reflect.apply(
        runtime.executor.session.inputObserved,
        runtime.executor.session,
        [bytes, 0, 0, primitiveOnly]
      )
    ).toThrow(TypeError);
    expect(guard.completedEntryToken()).toBe(token);
    expect(coercions).toBe(0);
    const observed = createInputCommitObservation();
    const result = await runtime.port.inputSettled(
      () => commitApplication(runtime, '"italic"'),
      { mainCommit: observed }
    );
    expect(result.status).toBe('success');
    expect(observed.read()).toMatchObject({
      status: 'published',
      entryId: 26n,
    });
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});
