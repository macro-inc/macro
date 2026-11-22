// @vitest-environment jsdom
// UNAPPLIED/UNRUN: production mount, native table-picker and Code producers.

import { SessionInputError } from '@macro-inc/collaboration/session/executor';
import { Telemetry } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  nativeAcknowledgementSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import { selectionMessage } from './session-port';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());

test.each([false, true])(
  'real consumed Picker proof refuses intervening query=%s',
  async (extraQuery) => {
    let armed = false;
    const fixture = await nativeAcknowledgementSurface((session) => {
      if (armed && extraQuery) session.listenerTable();
    });
    try {
      const generation = fixture.view.mirror.keyGeneration;
      if (generation === null) throw new Error('Missing mounted generation');
      const sync = fixture.port.inputApplicationSync;
      if (!sync) throw new Error('Missing shared synchronous input');
      let observed = 0;
      let after = 0;
      armed = true;
      const result = sync.call(
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
            throw new Error('Unexpected edit refusal');
          },
          observation: {
            name: 'group-b.table-picker',
            decode: (payload) => {
              observed++;
              return payload === null ? 'picker' : undefined;
            },
          },
          after: (handled, proof) => {
            expect(handled).toBe(true);
            expect(proof).toBe('picker');
            after++;
          },
        }
      );
      expect(result).toEqual({ status: 'completed' });
      expect(observed).toBe(extraQuery ? 0 : 1);
      expect(after).toBe(extraQuery ? 0 : 1);
      // Same actual instance must recover, without repairing cache or output state.
      armed = false;
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
            throw new Error('Unexpected edit refusal');
          },
          observation: {
            name: 'group-b.table-picker',
            decode: (payload) => (payload === null ? 'picker' : undefined),
          },
          after: (_, proof) => {
            expect(proof).toBe('picker');
            after++;
          },
        }
      );
      expect(after).toBe(extraQuery ? 1 : 2);
    } finally {
      armed = false;
      await fixture.close();
    }
  }
);

test('busy scheduling refusal reads no payload and installs no observer', async () => {
  const fixture = await nativeAcknowledgementSurface();
  try {
    const generation = fixture.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing mounted generation');
    const sync = fixture.port.inputApplicationSync;
    if (!sync) throw new Error('Missing shared synchronous input');
    let reads = 0;
    let after = 0;
    fixture.executor.runSync(() => {
      const result = sync.call(
        fixture.port,
        () => {
          reads++;
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
            throw new Error('Unexpected edit refusal');
          },
          after: () => after++,
        }
      );
      expect(result).toEqual({ status: 'refused', reason: 'busy-queued' });
      return fixture.session.tick(fixture.executor.now(), Date.now());
    });
    expect(reads).toBe(0);
    expect(after).toBe(0);
  } finally {
    await fixture.close();
  }
});

test('missing semantic event preserves independent handling without inventing proof or retry', async () => {
  const fixture = await nativeAcknowledgementSurface();
  try {
    const generation = fixture.view.mirror.keyGeneration;
    if (generation === null) throw new Error('Missing mounted generation');
    const sync = fixture.port.inputApplicationSync;
    if (!sync) throw new Error('Missing shared synchronous input');
    let calls = 0;
    let after = 0;
    expect(
      sync.call(
        fixture.port,
        () => {
          calls++;
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
            throw new Error('Unexpected edit refusal');
          },
          observation: { name: 'group-b.not-produced', decode: () => 'forged' },
          after: (handled, proof, disposition) => {
            expect(handled).toBe(true);
            expect(proof).toBeUndefined();
            expect(disposition).toEqual({
              defaultPrevented: false,
              propagationStopped: false,
            });
            after++;
          },
        }
      )
    ).toEqual({ status: 'completed' });
    expect(calls).toBe(1);
    expect(after).toBe(1);
  } finally {
    await fixture.close();
  }
});

test('actual Code generic consumption preserves prevention without the requested semantic proof', async () => {
  const fixture = await nativeAcknowledgementSurface();
  try {
    fixture.port.setState(
      JSON.stringify({
        root: {
          type: 'root',
          children: [
            {
              type: 'custom-code',
              language: 'rust',
              children: [{ type: 'text', text: 'code' }],
            },
          ],
        },
      })
    );
    const text = [...fixture.view.mirror.values()].find(
      (node) => node.text === 'code'
    );
    if (!text) throw new Error('Missing actual code text');
    fixture.port.selectionFromView({
      kind: 'range',
      anchor: { key: text.key, offset: 0, type: 'text' },
      focus: { key: text.key, offset: 0, type: 'text' },
    });
    const generation = fixture.view.mirror.keyGeneration;
    const sync = fixture.port.inputApplicationSync;
    if (!sync || generation === null)
      throw new Error('Missing actual owned sync binding');
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      keyCode: 38,
      cancelable: true,
    });
    let decode = 0;
    let after = 0;
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
        event,
        domEvent: event,
        domRefused: () => {
          throw new Error('Unexpected access refusal');
        },
        observation: {
          name: 'group-b.table-picker',
          decode: () => {
            decode++;
            return 'picker';
          },
        },
        after: (handled, proof, disposition) => {
          expect(handled).toBe(true);
          expect(proof).toBeUndefined();
          expect(disposition).toEqual({
            defaultPrevented: true,
            propagationStopped: false,
          });
          expect(event.defaultPrevented).toBe(true);
          after++;
        },
      }
    );
    expect(decode).toBe(0);
    expect(after).toBe(1);
    expect(event.defaultPrevented).toBe(true);
    expect(fixture.view.consumePreventDefault()).toBe(false);
    // Same production instance, normal next input and real observation.
    let next = 0;
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
          decode: (payload) => (payload === null ? 'picker' : undefined),
        },
        after: (_, proof, disposition) => {
          expect(proof).toBe('picker');
          expect(disposition).toEqual({
            defaultPrevented: false,
            propagationStopped: false,
          });
          next++;
        },
      }
    );
    expect(next).toBe(1);
  } finally {
    await fixture.close();
  }
});

test.each([undefined, null, { opaque: 'render-secondary' }])(
  'actual native no-prefix Error retains its own error over an onCommit secondary %j',
  async (secondary) => {
    const fixture = await nativeAcknowledgementSurface();
    let armed = false;
    let commitFaultFired = false;
    const remove = fixture.view.onCommit(() => {
      if (armed && !commitFaultFired) {
        commitFaultFired = true;
        throw secondary;
      }
    });
    let restoreReport: (() => void) | undefined;
    try {
      const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
      restoreReport = () => report.mockRestore();
      const generation = fixture.view.mirror.keyGeneration;
      const sync = fixture.port.inputApplicationSync;
      if (generation === null || !sync)
        throw new Error('Missing actual sync binding');
      const event = new KeyboardEvent('keydown', {
        key: 'e',
        cancelable: true,
      });
      let after = 0;
      armed = true;
      let caught: { readonly error: unknown } | undefined;
      try {
        sync.call(
          fixture.port,
          () => ({
            name: 'group-b.table',
            json: '{"action":"selection-split"}',
            generation,
            selection: selectionMessage({ kind: 'keep' }),
          }),
          {
            view: fixture.view,
            generation,
            current: () => true,
            admission: 'session-edit',
            domEvent: event,
            domRefused: () => {
              throw new Error('Unexpected access refusal');
            },
            observation: {
              name: 'group-b.not-produced',
              decode: () => 'forged',
            },
            after: () => {
              after++;
            },
          }
        );
      } catch (error) {
        caught = { error };
      }
      expect(caught).toBeDefined();
      expect(caught?.error).toBeInstanceOf(SessionInputError);
      expect(caught?.error).not.toBe(secondary);
      expect(commitFaultFired).toBe(true);
      expect(after).toBe(0);
      expect(event.defaultPrevented).toBe(false);
      expect(
        report.mock.calls.filter(([error]) => error === secondary)
      ).toHaveLength(1);
      armed = false;
      let next = 0;
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
            decode: (payload) => (payload === null ? 'picker' : undefined),
          },
          after: (_, proof) => {
            expect(proof).toBe('picker');
            next++;
          },
        }
      );
      expect(next).toBe(1);
      expect(fixture.view.consumePreventDefault()).toBe(false);
    } finally {
      armed = false;
      remove();
      try {
        await fixture.close();
      } finally {
        restoreReport?.();
      }
    }
  }
);

test.each([false, true])(
  'current Read/Comment admission precedes observers and lazy factories (comment=%s)',
  async (comment) => {
    const fixture = await nativeAcknowledgementSurface();
    let inputRestore: (() => void) | undefined;
    let observeRestore: (() => void) | undefined;
    try {
      fixture.executor.runSync(() =>
        fixture.session.authorization(
          true,
          false,
          comment,
          fixture.executor.now(),
          Date.now()
        )
      );
      const before = fixture.session.serializedState();
      const input = vi.spyOn(fixture.session, 'input');
      inputRestore = () => input.mockRestore();
      const observe = vi.spyOn(fixture.view, 'onPluginEvent');
      observeRestore = () => observe.mockRestore();
      const generation = fixture.view.mirror.keyGeneration;
      const sync = fixture.port.inputApplicationSync;
      const paste = fixture.port.pasteSync;
      if (generation === null || !sync || !paste)
        throw new Error('Missing current sync binding');
      let factories = 0;
      let refusals = 0;
      let after = 0;
      const event = new KeyboardEvent('keydown', {
        key: 'e',
        cancelable: true,
      });
      expect(
        sync.call(
          fixture.port,
          () => {
            factories++;
            throw new Error('Reader factory ran');
          },
          {
            view: fixture.view,
            generation,
            current: () => true,
            admission: 'session-edit',
            domEvent: event,
            domRefused: () => {
              refusals++;
              event.preventDefault();
            },
            observation: {
              name: 'group-b.not-produced',
              decode: () => 'forged',
            },
            after: () => {
              after++;
            },
          }
        )
      ).toEqual({ status: 'completed' });
      expect(
        paste.call(
          fixture.port,
          () => {
            factories++;
            throw new Error('Reader MIME factory ran');
          },
          {
            view: fixture.view,
            generation,
            current: () => true,
            domEvent: event,
            domRefused: () => {
              refusals++;
              event.preventDefault();
            },
            observation: {
              name: 'group-b.not-produced',
              decode: () => 'forged',
            },
            after: () => {
              after++;
            },
          }
        )
      ).toEqual({ status: 'completed' });
      expect(factories).toBe(0);
      expect(refusals).toBe(2);
      expect(after).toBe(0);
      expect(observe).not.toHaveBeenCalled();
      expect(input).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(fixture.session.serializedState()).toBe(before);
    } finally {
      try {
        observeRestore?.();
      } finally {
        try {
          inputRestore?.();
        } finally {
          await fixture.close();
        }
      }
    }
  }
);
