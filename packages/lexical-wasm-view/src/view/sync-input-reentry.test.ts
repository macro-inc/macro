// @vitest-environment jsdom
// UNAPPLIED/UNRUN: actual mounted production Port, view.apply, executor and WASM.

import { EditorInputMsg } from '@macro-inc/collaboration/session/abi.generated';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  nativeAcknowledgementSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import { selectionMessage } from './session-port';
import type { ViewSelection } from './types';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());

function picker(
  fixture: Awaited<ReturnType<typeof nativeAcknowledgementSurface>>,
  decode: () => void,
  after: () => void,
  accepted?: () => void
) {
  const generation = fixture.view.mirror.keyGeneration;
  const sync = fixture.port.inputApplicationSync;
  if (generation === null || !sync)
    throw new Error('Missing real sync binding');
  return sync.call(
    fixture.port,
    () => {
      accepted?.();
      return {
        name: 'group-b.table',
        json: '{"action":"picker"}',
        generation,
        selection: selectionMessage({ kind: 'keep' }),
      };
    },
    {
      view: fixture.view,
      generation,
      current: () => true,
      admission: 'session-edit',
      domEvent: new KeyboardEvent('keydown', { cancelable: true }),
      domRefused: () => {
        throw new Error('Unexpected access refusal');
      },
      observation: {
        name: 'group-b.table-picker',
        decode: (payload) => {
          decode();
          return payload === null ? 'picker' : undefined;
        },
      },
      after: (_, proof) => {
        expect(proof).toBe('picker');
        after();
      },
    }
  );
}

test.each([undefined, null, { opaque: 'outer-apply' }])(
  'outer onCommit error cannot poison same-view afterDrain reentry %j',
  async (cause) => {
    let armed = false;
    let reentered = false;
    let innerAfter = 0;
    let outerAfter = 0;
    let oldProofReads = 0;
    let newProofReads = 0;
    let commitFaultFired = false;
    const fixture = await nativeAcknowledgementSurface(undefined, () => {
      if (!armed || reentered) return;
      reentered = true;
      run('inner');
    });
    function run(kind: 'outer' | 'inner' | 'next') {
      return picker(
        fixture,
        () => {
          if (kind === 'outer') oldProofReads++;
          else newProofReads++;
        },
        () => {
          if (kind === 'outer') outerAfter++;
          else innerAfter++;
        }
      );
    }
    const remove = fixture.view.onCommit(() => {
      if (armed && !reentered && !commitFaultFired) {
        commitFaultFired = true;
        throw cause;
      }
    });
    try {
      armed = true;
      let thrown: { readonly error: unknown } | undefined;
      try {
        run('outer');
      } catch (error) {
        thrown = { error };
      }
      expect(thrown).toBeDefined();
      expect(thrown?.error).toBe(cause);
      expect(reentered).toBe(true);
      expect(commitFaultFired).toBe(true);
      expect(oldProofReads).toBe(1);
      expect(newProofReads).toBe(1);
      expect(outerAfter).toBe(0);
      expect(innerAfter).toBe(1);
      armed = false;
      expect(run('next')).toEqual({ status: 'completed' });
      expect(oldProofReads).toBe(1);
      expect(newProofReads).toBe(2);
      expect(innerAfter).toBe(2);
      expect(fixture.view.consumePreventDefault()).toBe(false);
    } finally {
      armed = false;
      remove();
      await fixture.close();
    }
  }
);

test.each([undefined, null, { opaque: 'inner-apply' }])(
  'a locally observed inner error does not retroactively fail the resumed outer entry %j',
  async (cause) => {
    let armed = false;
    let reentered = false;
    let inner = false;
    let commitFaultFired = false;
    let innerFailure: { readonly error: unknown } | undefined;
    let outerAfter = 0;
    let innerAfter = 0;
    const fixture = await nativeAcknowledgementSurface(undefined, () => {
      if (!armed || reentered) return;
      reentered = true;
      inner = true;
      try {
        run(true);
      } catch (error) {
        innerFailure = { error };
      } finally {
        inner = false;
      }
    });
    function run(isInner: boolean) {
      return picker(
        fixture,
        () => {},
        () => {
          if (isInner) innerAfter++;
          else outerAfter++;
        }
      );
    }
    const remove = fixture.view.onCommit(() => {
      if (armed && inner && !commitFaultFired) {
        commitFaultFired = true;
        throw cause;
      }
    });
    try {
      armed = true;
      expect(run(false)).toEqual({ status: 'completed' });
      expect(commitFaultFired).toBe(true);
      expect(innerFailure).toBeDefined();
      expect(innerFailure?.error).toBe(cause);
      expect(outerAfter).toBe(1);
      expect(innerAfter).toBe(0);
      armed = false;
      expect(run(false)).toEqual({ status: 'completed' });
      expect(outerAfter).toBe(2);
    } finally {
      armed = false;
      remove();
      await fixture.close();
    }
  }
);

test.each([undefined, null, { opaque: 'queued-legacy-apply' }])(
  'mixed sync and queued legacy apply failure preserves its drain through healthy reentry %j',
  async (cause) => {
    for (const owned of [false, true]) {
      let armed = false;
      let reentered = false;
      let commits = 0;
      let outerProof = 0;
      let outerAfter = 0;
      let innerProof = 0;
      let innerAfter = 0;
      let innerSelection: ViewSelection | undefined;
      let innerFailure: { readonly error: unknown } | undefined;
      const fixture = await nativeAcknowledgementSurface(undefined, () => {
        if (!armed || reentered) return;
        reentered = true;
        innerSelection = fixture.view.selection().selection;
        try {
          picker(
            fixture,
            () => innerProof++,
            () => innerAfter++
          );
        } catch (error) {
          // Passive holder preserves the actual nested cause; inherited drain
          // handling still receives exactly the original opaque exception.
          innerFailure = { error };
          throw error;
        }
      });
      const remove = fixture.view.onCommit(() => {
        if (!armed) return;
        commits++;
        if (!reentered && commits === (owned ? 2 : 1)) throw cause;
      });
      const queueLegacy = () => {
        const generation = fixture.view.mirror.keyGeneration;
        if (generation === null) throw new Error('Missing actual generation');
        fixture.port.input(
          EditorInputMsg.fromEditorApplication({
            name: 'group-b.format-element',
            json: '"center"',
            generation,
            selection: selectionMessage({ kind: 'keep' }),
            keyboard: false,
            key: '',
            mods: 0,
            code: 0,
          })
        );
      };
      try {
        const initial = fixture.view.selection().selection;
        expect(initial.kind).toBe('range');
        const parent = fixture.view.node(fixture.leaf.key)?.parent;
        if (parent === undefined || parent === null)
          throw new Error('Missing attached paragraph');
        expect(fixture.view.node(parent)?.elementProps?.format).toBe(0);
        armed = true;
        let thrown: { readonly error: unknown } | undefined;
        try {
          if (owned)
            picker(
              fixture,
              () => outerProof++,
              () => outerAfter++,
              queueLegacy
            );
          else queueLegacy();
        } catch (error) {
          thrown = { error };
        }
        expect(thrown).toBeDefined();
        expect(thrown?.error).toBe(cause);
        expect(reentered).toBe(true);
        expect(outerProof).toBe(owned ? 1 : 0);
        expect(outerAfter).toBe(owned ? 1 : 0);
        // Expose the original opaque nested failure outside the real callback.
        if (innerFailure !== undefined) throw innerFailure.error;
        expect(innerSelection).toEqual(initial);
        expect(innerFailure).toBeUndefined();
        expect(innerProof).toBe(1);
        expect(innerAfter).toBe(1);
        expect(fixture.executor.runningDrain).toBeUndefined();
        armed = false;
        expect(
          picker(
            fixture,
            () => innerProof++,
            () => innerAfter++
          )
        ).toEqual({ status: 'completed' });
        expect(innerProof).toBe(2);
        expect(innerAfter).toBe(2);
        expect(fixture.view.consumePreventDefault()).toBe(false);
      } finally {
        armed = false;
        try {
          remove();
        } finally {
          await fixture.close();
        }
      }
    }
  }
);

test.each([undefined, null, { opaque: 'no-selection-legacy-apply' }])(
  'queued legacy SetState gives no selection and no picker observation %j',
  async (cause) => {
    for (const owned of [false, true]) {
      let armed = false;
      let reentered = false;
      let commits = 0;
      let outerProof = 0;
      let outerAfter = 0;
      let innerProof = 0;
      let innerAfter = 0;
      let innerSelection: ViewSelection | undefined;
      let result: { handled: boolean; proof: unknown } | undefined;
      let innerFailure: { readonly error: unknown } | undefined;
      const fixture = await nativeAcknowledgementSurface(undefined, () => {
        if (!armed || reentered) return;
        reentered = true;
        try {
          innerSelection = fixture.view.selection().selection;
          const generation = fixture.view.mirror.keyGeneration;
          const sync = fixture.port.inputApplicationSync;
          if (generation === null || !sync)
            throw new Error('Missing actual sync binding');
          sync.call(
            fixture.port,
            () => ({
              name: 'group-b.table',
              json: '{"action":"picker"}',
              generation,
              selection: selectionMessage({ kind: 'keep' }),
            }),
            {
              view: fixture.view,
              generation,
              current: () => true,
              admission: 'session-edit',
              domEvent: new KeyboardEvent('keydown', { cancelable: true }),
              domRefused: () => {
                throw new Error('Unexpected access refusal');
              },
              observation: {
                name: 'group-b.table-picker',
                decode: (payload) => {
                  innerProof++;
                  return payload === null ? 'picker' : undefined;
                },
              },
              after: (handled, proof) => {
                innerAfter++;
                result = { handled, proof };
              },
            }
          );
        } catch (error) {
          // Passive holder preserves the actual nested cause; inherited drain
          // handling still receives exactly the original opaque exception.
          innerFailure = { error };
          throw error;
        }
      });
      const remove = fixture.view.onCommit(() => {
        if (!armed) return;
        commits++;
        if (!reentered && commits === (owned ? 2 : 1)) throw cause;
      });
      const queueLegacy = () =>
        fixture.port.setState(
          JSON.stringify({
            root: {
              type: 'root',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'text', text: 'legacy change' }],
                },
              ],
            },
          })
        );
      try {
        armed = true;
        let thrown: { readonly error: unknown } | undefined;
        try {
          if (owned)
            picker(
              fixture,
              () => outerProof++,
              () => outerAfter++,
              queueLegacy
            );
          else queueLegacy();
        } catch (error) {
          thrown = { error };
        }
        expect(thrown).toBeDefined();
        expect(thrown?.error).toBe(cause);
        expect(reentered).toBe(true);
        expect(outerProof).toBe(owned ? 1 : 0);
        expect(outerAfter).toBe(owned ? 1 : 0);
        // Expose the original opaque nested failure outside the real callback.
        if (innerFailure !== undefined) throw innerFailure.error;
        expect(innerFailure).toBeUndefined();
        expect(innerSelection).toEqual({ kind: 'none' });
        expect(innerProof).toBe(0);
        expect(result).toEqual({ handled: false, proof: undefined });
        expect(innerAfter).toBe(1);
        expect(fixture.executor.runningDrain).toBeUndefined();
        armed = false;
        // An explicit new selection makes the next picker a genuine healthy input.
        const leaf = [...fixture.view.mirror.values()].find(
          (node) => node.type === 'text' && node.text === 'legacy change'
        );
        if (!leaf) throw new Error('Missing actual replacement leaf');
        fixture.port.selectionFromView({
          kind: 'range',
          anchor: { key: leaf.key, offset: 0, type: 'text' },
          focus: { key: leaf.key, offset: 0, type: 'text' },
        });
        expect(
          picker(
            fixture,
            () => innerProof++,
            () => innerAfter++
          )
        ).toEqual({ status: 'completed' });
        expect(innerProof).toBe(1);
        expect(innerAfter).toBe(2);
        expect(fixture.view.consumePreventDefault()).toBe(false);
      } finally {
        armed = false;
        try {
          remove();
        } finally {
          await fixture.close();
        }
      }
    }
  }
);
