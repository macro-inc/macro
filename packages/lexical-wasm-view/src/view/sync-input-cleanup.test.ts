// @vitest-environment jsdom
// UNAPPLIED/UNRUN. Explicit post-cleanup faults on actual mounted production paths.

import { SessionInputError } from '@macro-inc/collaboration/session/executor';
import { Telemetry } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  nativeAcknowledgementSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import { NativeEnterOutput } from './native-enter-output';
import { selectionMessage } from './session-port';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());

function tableInput(
  fixture: Awaited<ReturnType<typeof nativeAcknowledgementSurface>>,
  action: 'picker' | 'selection-split',
  observe: () => void,
  after: () => void
) {
  const generation = fixture.view.mirror.keyGeneration;
  const sync = fixture.port.inputApplicationSync;
  if (generation === null || !sync)
    throw new Error('Missing actual sync binding');
  return sync.call(
    fixture.port,
    () => ({
      name: 'group-b.table',
      json: JSON.stringify({ action }),
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
          observe();
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

test.each([undefined, null, { opaque: 'cleanup-only' }])(
  'cleanup-only failures retain opaque identity and allow the next production input %j',
  async (cause) => {
    for (const phase of [
      'guard',
      'ticket',
      'unsubscribe-before',
      'unsubscribe-after',
    ] as const) {
      const fixture = await nativeAcknowledgementSurface();
      let armed = true;
      let faults = 0;
      const pendingReleases = new Set<() => void>();
      let observed = 0;
      let after = 0;
      let restoreFault = () => {};
      let restoreReport = () => {};
      try {
        const report = vi
          .spyOn(Telemetry, 'error')
          .mockImplementation(() => {});
        restoreReport = () => report.mockRestore();
        if (phase === 'guard') {
          const original = NativeEnterOutput.prototype.finishSyncCleanup;
          const spy = vi
            .spyOn(NativeEnterOutput.prototype, 'finishSyncCleanup')
            .mockImplementation(function (this: NativeEnterOutput, ...args) {
              Reflect.apply(original, this, args);
              if (armed) {
                armed = false;
                faults++;
                throw cause;
              }
            });
          restoreFault = () => spy.mockRestore();
        } else if (phase === 'ticket') {
          const original = NativeEnterOutput.prototype.finishSyncInput;
          const spy = vi
            .spyOn(NativeEnterOutput.prototype, 'finishSyncInput')
            .mockImplementation(function (this: NativeEnterOutput, ...args) {
              Reflect.apply(original, this, args);
              if (armed) {
                armed = false;
                faults++;
                throw cause;
              }
            });
          restoreFault = () => spy.mockRestore();
        } else {
          const original = fixture.view.onPluginEvent.bind(fixture.view);
          const spy = vi
            .spyOn(fixture.view, 'onPluginEvent')
            .mockImplementation((...args) => {
              const release = original(...args);
              pendingReleases.add(release);
              return () => {
                if (armed && phase === 'unsubscribe-before') {
                  armed = false;
                  faults++;
                  // The actual old subscription remains installed. Its holder
                  // must already be terminal before the next native proof.
                  throw cause;
                }
                release();
                pendingReleases.delete(release);
                if (armed) {
                  armed = false;
                  faults++;
                  throw cause;
                }
              };
            });
          restoreFault = () => spy.mockRestore();
        }
        let caught: { readonly error: unknown } | undefined;
        try {
          tableInput(
            fixture,
            'picker',
            () => observed++,
            () => after++
          );
        } catch (error) {
          caught = { error };
        }
        expect(faults).toBe(1);
        // Publication/semantic proof happened before terminal cleanup failed.
        expect(observed).toBe(1);
        expect(after).toBe(1);
        expect(caught).toBeDefined();
        expect(caught?.error).toBe(cause);
        expect(fixture.executor.runningDrain).toBeUndefined();
        expect(
          tableInput(
            fixture,
            'picker',
            () => observed++,
            () => after++
          )
        ).toEqual({ status: 'completed' });
        expect(observed).toBe(2);
        expect(after).toBe(2);
        expect(faults).toBe(1);
        expect(fixture.view.consumePreventDefault()).toBe(false);
      } finally {
        armed = false;
        try {
          for (const release of pendingReleases) release();
        } finally {
          try {
            restoreFault();
          } finally {
            try {
              restoreReport();
            } finally {
              await fixture.close();
            }
          }
        }
      }
    }
  }
);

test.each([undefined, null, { opaque: 'entry-primary' }])(
  'an earlier entry primary wins and every independent terminal fault is reported once %j',
  async (primary) => {
    const fixture = await nativeAcknowledgementSurface();
    const reporter = { opaque: 'secondary-reporter' };
    const cleanupFaults = [
      undefined,
      null,
      { opaque: 'unsubscribe-secondary' },
    ];
    let armed = true;
    const order: string[] = [];
    let after = 0;
    let observed = 0;
    let commitFaultFired = false;
    const restoreFaults: (() => void)[] = [];
    let restoreReport = () => {};
    const remove = fixture.view.onCommit(() => {
      if (armed && !commitFaultFired) {
        commitFaultFired = true;
        throw primary;
      }
    });
    let original: { readonly error: unknown } | undefined;
    let testFailure: { readonly error: unknown } | undefined;
    const cleanupErrors: { readonly error: unknown }[] = [];
    try {
      const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {
        throw reporter;
      });
      restoreReport = () => report.mockRestore();
      const guardOriginal = NativeEnterOutput.prototype.finishSyncCleanup;
      const guard = vi
        .spyOn(NativeEnterOutput.prototype, 'finishSyncCleanup')
        .mockImplementation(function (this: NativeEnterOutput, ...args) {
          Reflect.apply(guardOriginal, this, args);
          if (armed) {
            order.push('guard');
            throw cleanupFaults[0];
          }
        });
      restoreFaults.push(() => guard.mockRestore());
      const ticketOriginal = NativeEnterOutput.prototype.finishSyncInput;
      const ticket = vi
        .spyOn(NativeEnterOutput.prototype, 'finishSyncInput')
        .mockImplementation(function (this: NativeEnterOutput, ...args) {
          Reflect.apply(ticketOriginal, this, args);
          if (armed) {
            order.push('ticket');
            throw cleanupFaults[1];
          }
        });
      restoreFaults.push(() => ticket.mockRestore());
      const onPluginEvent = fixture.view.onPluginEvent.bind(fixture.view);
      const unsubscribe = vi
        .spyOn(fixture.view, 'onPluginEvent')
        .mockImplementation((...args) => {
          const release = onPluginEvent(...args);
          return () => {
            release();
            if (armed) {
              order.push('unsubscribe');
              throw cleanupFaults[2];
            }
          };
        });
      restoreFaults.push(() => unsubscribe.mockRestore());
      try {
        tableInput(
          fixture,
          'picker',
          () => observed++,
          () => after++
        );
      } catch (error) {
        original = { error };
      }
      expect(original).toBeDefined();
      expect(original?.error).toBe(primary);
      expect(commitFaultFired).toBe(true);
      expect(order).toEqual(['guard', 'ticket', 'unsubscribe']);
      expect(observed).toBe(1);
      expect(after).toBe(0);
      for (const cause of cleanupFaults)
        expect(
          report.mock.calls.filter(([error]) => error === cause)
        ).toHaveLength(1);
      armed = false;
      expect(
        tableInput(
          fixture,
          'picker',
          () => observed++,
          () => after++
        )
      ).toEqual({ status: 'completed' });
      expect(observed).toBe(2);
      expect(after).toBe(1);
      expect(order).toHaveLength(3);
      for (const cause of cleanupFaults)
        expect(
          report.mock.calls.filter(([error]) => error === cause)
        ).toHaveLength(1);
      expect(fixture.executor.runningDrain).toBeUndefined();
    } catch (error) {
      testFailure = { error };
      throw error;
    } finally {
      armed = false;
      for (const release of restoreFaults.reverse()) {
        try {
          release();
        } catch (error) {
          cleanupErrors.push({ error });
        }
      }
      try {
        remove();
      } catch (error) {
        cleanupErrors.push({ error });
      }
      try {
        restoreReport();
      } catch (error) {
        cleanupErrors.push({ error });
      }
      try {
        await fixture.close();
      } catch (error) {
        cleanupErrors.push({ error });
      }
    }
    if (!testFailure && cleanupErrors.length) throw cleanupErrors[0].error;
  }
);

test('native Error outranks an actual unsubscribe failure and the next input has no inherited fault', async () => {
  const fixture = await nativeAcknowledgementSurface();
  const cleanup = { opaque: 'native-error-cleanup' };
  let armed = true;
  let observed = 0;
  let after = 0;
  let restoreFault = () => {};
  let restoreReport = () => {};
  try {
    const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
    restoreReport = () => report.mockRestore();
    const original = fixture.view.onPluginEvent.bind(fixture.view);
    const spy = vi
      .spyOn(fixture.view, 'onPluginEvent')
      .mockImplementation((...args) => {
        const release = original(...args);
        return () => {
          release();
          if (armed) throw cleanup;
        };
      });
    restoreFault = () => spy.mockRestore();
    let caught: { readonly error: unknown } | undefined;
    try {
      tableInput(
        fixture,
        'selection-split',
        () => observed++,
        () => after++
      );
    } catch (error) {
      caught = { error };
    }
    expect(caught).toBeDefined();
    expect(caught?.error).toBeInstanceOf(SessionInputError);
    expect(caught?.error).not.toBe(cleanup);
    expect(
      report.mock.calls.filter(([error]) => error === cleanup)
    ).toHaveLength(1);
    expect(observed).toBe(0);
    expect(after).toBe(0);
    armed = false;
    expect(
      tableInput(
        fixture,
        'picker',
        () => observed++,
        () => after++
      )
    ).toEqual({ status: 'completed' });
    expect(observed).toBe(1);
    expect(after).toBe(1);
    expect(fixture.executor.runningDrain).toBeUndefined();
  } finally {
    armed = false;
    try {
      restoreFault();
    } finally {
      try {
        restoreReport();
      } finally {
        await fixture.close();
      }
    }
  }
});
