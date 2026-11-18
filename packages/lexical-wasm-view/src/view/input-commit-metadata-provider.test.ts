/** @vitest-environment jsdom */
// Requires the NEW coherent task-peer ordinary artifact. No old-pair qualification.
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  nativeAcknowledgementSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import { createInputCommitObservation } from './input-commit-observation';
import {
  commitApplication,
  mountInputCommitFixture,
  native,
  seedInputCommitFixture,
} from './input-commit-test-fixture';
import { NativeEnterDispatcher } from './native-enter';
import { selectionMessage } from './session-port';

let restore: (() => void) | undefined;
let trace: string[] = [];
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
  // Instrument before permanent guard installation. Every native spy delegates.
  const read = native.EditorSession.prototype.readInputCommitReceipt;
  vi.spyOn(
    native.EditorSession.prototype,
    'readInputCommitReceipt'
  ).mockImplementation(function (this: native.EditorSession, ...args) {
    trace.push('receipt.read');
    const receipt = read.call(this, ...args);
    trace.push('receipt.read.return');
    return receipt;
  });
  const release = native.InputCommitReceipt.prototype.free;
  vi.spyOn(native.InputCommitReceipt.prototype, 'free').mockImplementation(
    function (this: native.InputCommitReceipt) {
      release.call(this);
      trace.push('receipt.free.return');
    }
  );
  const take = native.EditorSession.prototype.takeOutput;
  vi.spyOn(native.EditorSession.prototype, 'takeOutput').mockImplementation(
    function (this: native.EditorSession) {
      const output = take.call(this);
      trace.push('output.take.return');
      return output;
    }
  );
  const free = native.EditorSession.prototype.free;
  vi.spyOn(native.EditorSession.prototype, 'free').mockImplementation(function (
    this: native.EditorSession
  ) {
    free.call(this);
    trace.push('session.free.return');
  });
});
afterAll(() => restore?.());

test('receipt copy/free on an observed entry does not poison the next fresh metadata echo', async () => {
  const runtime = mountInputCommitFixture();
  try {
    await seedInputCommitFixture(runtime);
    const seen = createInputCommitObservation();
    const result = await runtime.port.inputSettled(
      () => commitApplication(runtime),
      { mainCommit: seen }
    );
    expect(result.status).toBe('success');
    expect(seen.read().status).toBe('published');
    const text = [...runtime.view.mirror.values()].find(
      (n) => n.type === 'text'
    );
    if (!text) throw new Error('Missing actual formatted text');
    const ack = vi.spyOn(runtime.view, 'acknowledgeText');
    try {
      // Establish actual DOM ownership first, independently of the observed input.
      runtime.port.textFromView({
        key: text.key,
        text: 'commit!',
        anchorOffset: 7,
        focusOffset: 7,
      });
      ack.mockClear();
      runtime.port.textFromView({
        key: text.key,
        text: 'commit!!',
        anchorOffset: 8,
        focusOffset: 8,
      });
      expect(ack).toHaveBeenCalledTimes(1);
      expect(runtime.executor.session.nodeText(text.key)).toBe('commit!!');
      expect(runtime.view.text(text.key)).toBe('commit!!');
    } finally {
      ack.mockRestore();
    }
  } finally {
    await runtime.close();
    runtime.root.remove();
  }
});

test('another owner receipt read/free cannot bless an earlier metadata echo ticket', async () => {
  const other = mountInputCommitFixture();
  let armed = false;
  let interposed = false;
  let entryId: bigint | undefined;
  const fixture = await nativeAcknowledgementSurface(() => {
    if (!armed || interposed || entryId === undefined) return;
    interposed = true;
    const receipt = other.executor.session.readInputCommitReceipt(`${entryId}`);
    try {
      expect(receipt.entryId).toBe(entryId);
      expect(receipt.mainKind).toBe(native.InputCommitKind.Published);
    } finally {
      receipt.free();
    }
  });
  const ack = vi.spyOn(fixture.view, 'acknowledgeText');
  try {
    await seedInputCommitFixture(other);
    const seen = createInputCommitObservation();
    await other.port.inputSettled(() => commitApplication(other), {
      mainCommit: seen,
    });
    const evidence = seen.read();
    if (evidence.status !== 'published')
      throw new Error('Missing actual main receipt');
    entryId = evidence.entryId;
    const guard = NativeEnterDispatcher.forModule(native).guard;
    const before = guard.completedEntryToken();
    armed = true;
    expect(() =>
      fixture.port.textFromView({
        key: fixture.leaf.key,
        text: 'ab',
        anchorOffset: 2,
        focusOffset: 2,
      })
    ).toThrow('TextFromView mirror divergence');
    expect(interposed).toBe(true);
    expect(guard.completedEntryToken()).toBeGreaterThan(before);
    expect(ack).not.toHaveBeenCalled();
    expect(fixture.session.nodeText(fixture.leaf.key)).toBe('ab');
    expect(fixture.view.text(fixture.leaf.key)).toBe('a');
    expect(seen.read()).toBe(evidence);
  } finally {
    armed = false;
    ack.mockRestore();
    await fixture.close();
    await other.close();
    other.root.remove();
  }
});

for (const action of ['keep', 'close']) {
  for (const error of [undefined, null, { kind: 'composed-observer-error' }]) {
    test(`provider fence and copied receipt precede opaque ${action}: ${String(error)}`, async () => {
      let armed = false;
      let runtime: ReturnType<typeof mountInputCommitFixture> | undefined;
      const refusals: { error: unknown }[] = [];
      const calls: string[][] = [];
      runtime = mountInputCommitFixture(true, (op, language, text, profile) => {
        if (armed) {
          calls.push([op, language, text, profile]);
          if (!runtime) throw new Error('Missing actual provider owner');
          for (const attempt of [
            () => runtime?.executor.session.serializedState(),
            () => runtime?.executor.session.free(),
            () =>
              runtime?.executor.session.inputObserved(
                new Uint8Array(),
                0,
                0,
                '1000'
              ),
          ]) {
            try {
              attempt();
            } catch (error) {
              refusals.push({ error });
            }
          }
        }
        return JSON.stringify(
          op === 'loaded'
            ? { kind: 'loaded', loaded: armed }
            : {
                kind: 'tokens',
                tokens: [{ kind: 'text', text, highlightType: 'word' }],
              }
        );
      });
      const fixture = runtime;
      let closing: Promise<void> | undefined;
      try {
        fixture.port.setState(
          JSON.stringify({
            root: {
              type: 'root',
              version: 1,
              children: [
                {
                  type: 'custom-code',
                  version: 1,
                  language: 'plaintext',
                  children: [{ type: 'text', version: 1, text: 'let a' }],
                },
              ],
            },
          })
        );
        const code = [...fixture.view.mirror.values()].find(
          (n) => n.type === 'custom-code'
        );
        const generation = fixture.view.mirror.keyGeneration;
        if (!code || generation === null)
          throw new Error('Missing actual code state');
        trace = [];
        armed = true;
        const observerRefusals: { error: unknown }[] = [];
        const seen = createInputCommitObservation(() => {
          trace.push('observer');
          for (const attempt of [
            () => fixture.executor.session.serializedState(),
            () => fixture.executor.session.free(),
            () =>
              fixture.executor.session.inputObserved(
                new Uint8Array(),
                0,
                0,
                '2000'
              ),
          ]) {
            try {
              attempt();
            } catch (error) {
              observerRefusals.push({ error });
            }
          }
          if (action === 'close') {
            closing = fixture.close();
            trace.push('close.request');
          }
          throw error;
        });
        const result = await fixture.port.inputSettled(
          () => ({
            name: 'group-b.code',
            json: JSON.stringify({
              action: 'language',
              key: code.key,
              language: 'rust',
            }),
            generation,
            selection: selectionMessage({ kind: 'keep' }),
          }),
          { mainCommit: seen }
        );
        expect(result.status).toBe('error');
        if (result.status !== 'error')
          throw new Error('Missing opaque observer error');
        expect(Object.hasOwn(result, 'error')).toBe(true);
        expect(result.error).toBe(error);
        const evidence = seen.read();
        expect(evidence).toMatchObject({
          status: 'published',
          mainHandled: true,
        });
        if (evidence.status !== 'published')
          throw new Error('Missing main publication');
        // The denied provider's high-ID attempt must never reach correlation recording.
        expect(evidence.entryId).toBe(1n);
        expect(result.mainCommit).toBe(evidence);
        expect(observerRefusals).toHaveLength(3);
        expect(
          calls.some(
            (call) =>
              call[0] === 'tokenize' &&
              call[1] === 'rust' &&
              call[2] === 'let a' &&
              call[3] === 'main-commit-composed-gate'
          )
        ).toBe(true);
        expect(refusals).toHaveLength(calls.length * 3);
        for (const refusal of refusals)
          expect(refusal.error).toBeInstanceOf(Error);
        expect(trace.indexOf('receipt.read.return')).toBeLessThan(
          trace.indexOf('receipt.free.return')
        );
        expect(trace.indexOf('receipt.free.return')).toBeLessThan(
          trace.indexOf('observer')
        );
        expect(trace.indexOf('observer')).toBeLessThan(
          trace.indexOf('output.take.return')
        );
        if (action === 'close') {
          if (!closing) throw new Error('Missing actual deferred close');
          await closing;
          expect(trace.lastIndexOf('output.take.return')).toBeLessThan(
            trace.indexOf('session.free.return')
          );
          expect(
            trace.filter((item) => item === 'session.free.return')
          ).toHaveLength(1);
        } else {
          armed = false;
          const next = createInputCommitObservation();
          const settled = await fixture.port.inputSettled(
            () => ({
              name: 'group-b.code',
              json: JSON.stringify({
                action: 'language',
                key: code.key,
                language: 'javascript',
              }),
              generation,
              selection: selectionMessage({ kind: 'keep' }),
            }),
            { mainCommit: next }
          );
          expect(settled.status).toBe('success');
          // Both refused high-ID attempts leave actual module correlation unchanged.
          expect(next.read()).toMatchObject({
            status: 'published',
            entryId: 2n,
          });
        }
      } finally {
        armed = false;
        await (closing ?? fixture.close());
        fixture.root.remove();
      }
    });
  }
}
