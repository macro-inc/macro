// @vitest-environment jsdom
// UNAPPLIED/UNRUN: explicit fixture boundary faults, not product parity failures.

import { SessionExecutor } from '@macro-inc/collaboration/session/executor';
import { Telemetry } from '@macro-inc/observability';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  initializeNativeKeyboardSurface,
  type NativeKeyboardCleanupFailure,
  nativeAcknowledgementSurface,
} from '../../../../apps/web/src/lib/core/component/LexicalMarkdown/editing/test/native-keyboard-surface';
import * as native from '../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import { SessionPort } from './session-port';

let restore: (() => void) | undefined;
beforeAll(() => {
  restore = initializeNativeKeyboardSurface();
});
afterAll(() => restore?.());

test.each([undefined, null, { opaque: 'setup-primary' }])(
  'partial descriptor and initializer faults restore both original globals %j',
  (primary) => {
    for (const phase of ['descriptor', 'initializer'] as const) {
      const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
      const scroll = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        'scrollIntoView'
      );
      const define = Object.defineProperty;
      const secondary: NativeKeyboardCleanupFailure[] = [];
      let reached = 0;
      let restoreFault = () => {};
      try {
        if (phase === 'descriptor') {
          let armed = true;
          const spy = vi
            .spyOn(Object, 'defineProperty')
            .mockImplementation((target, key, descriptor) => {
              if (
                armed &&
                target === HTMLElement.prototype &&
                key === 'scrollIntoView'
              ) {
                armed = false;
                reached++;
                expect(
                  Object.getOwnPropertyDescriptor(navigator, 'locks')
                ).not.toBeUndefined();
                throw primary;
              }
              return define(target, key, descriptor);
            });
          restoreFault = () => spy.mockRestore();
        } else {
          const spy = vi.spyOn(native, 'initSync').mockImplementation(() => {
            reached++;
            expect(
              Object.getOwnPropertyDescriptor(navigator, 'locks')
            ).not.toBeUndefined();
            expect(
              Object.getOwnPropertyDescriptor(
                HTMLElement.prototype,
                'scrollIntoView'
              )
            ).not.toEqual(scroll);
            throw primary;
          });
          restoreFault = () => spy.mockRestore();
        }
        let caught: { readonly error: unknown } | undefined;
        try {
          initializeNativeKeyboardSurface(secondary);
        } catch (error) {
          caught = { error };
        }
        expect(reached).toBe(1);
        expect(caught).toBeDefined();
        expect(caught?.error).toBe(primary);
        expect(secondary).toEqual([]);
        expect(Object.getOwnPropertyDescriptor(navigator, 'locks')).toEqual(
          locks
        );
        expect(
          Object.getOwnPropertyDescriptor(
            HTMLElement.prototype,
            'scrollIntoView'
          )
        ).toEqual(scroll);
      } finally {
        try {
          restoreFault();
        } finally {
          try {
            if (locks) define(navigator, 'locks', locks);
            else Reflect.deleteProperty(navigator, 'locks');
          } finally {
            if (scroll) define(HTMLElement.prototype, 'scrollIntoView', scroll);
            else
              Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
          }
        }
      }
    }
  }
);

test.each([undefined, null, { opaque: 'restore-primary' }])(
  'a failed first restoration cannot skip the second or replace an opaque cleanup value %j',
  (primary) => {
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    const scroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    );
    const define = Object.defineProperty;
    const secondary: NativeKeyboardCleanupFailure[] = [];
    const cleanup = initializeNativeKeyboardSurface(secondary);
    let armed = true;
    let scrollRestored = 0;
    let restoreFault = () => {};
    let restoreReport = () => {};
    try {
      const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {
        throw new Error('injected secondary reporter fault');
      });
      restoreReport = () => report.mockRestore();
      const spy = vi
        .spyOn(Object, 'defineProperty')
        .mockImplementation((target, key, descriptor) => {
          if (armed && target === navigator && key === 'locks') {
            armed = false;
            throw primary;
          }
          if (target === HTMLElement.prototype && key === 'scrollIntoView')
            scrollRestored++;
          return define(target, key, descriptor);
        });
      restoreFault = () => spy.mockRestore();
      let caught: { readonly error: unknown } | undefined;
      try {
        cleanup();
      } catch (error) {
        caught = { error };
      }
      expect(scrollRestored).toBe(1);
      expect(caught).toBeDefined();
      expect(caught?.error).toBe(primary);
      expect(secondary).toEqual([{ error: primary }]);
      expect(
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
      ).toEqual(scroll);
      expect(report).toHaveBeenCalledExactlyOnceWith(primary, {
        surface: 'native.keyboard.fixture.cleanup',
      });
      cleanup(); // No double restoration/report after terminal cleanup.
      expect(scrollRestored).toBe(1);
    } finally {
      try {
        restoreFault();
      } finally {
        try {
          restoreReport();
        } finally {
          try {
            if (locks) define(navigator, 'locks', locks);
            else Reflect.deleteProperty(navigator, 'locks');
          } finally {
            if (scroll) define(HTMLElement.prototype, 'scrollIntoView', scroll);
            else
              Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
          }
        }
      }
    }
  }
);

test.each([undefined, null, { opaque: 'initializer-primary' }])(
  'initializer failure keeps its primary while both restoration faults remain raw %j',
  (primary) => {
    const locks = Object.getOwnPropertyDescriptor(navigator, 'locks');
    const scroll = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    );
    const define = Object.defineProperty;
    const lockFailure = { opaque: 'locks-restore' };
    const scrollFailure = { opaque: 'scroll-restore' };
    const secondary: NativeKeyboardCleanupFailure[] = [];
    let restoring = false;
    const releases: (() => void)[] = [];
    let testFailure: { readonly error: unknown } | undefined;
    const failures: NativeKeyboardCleanupFailure[] = [];
    try {
      const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {
        throw new Error('injected reporter fault');
      });
      releases.push(() => report.mockRestore());
      const init = vi.spyOn(native, 'initSync').mockImplementation(() => {
        restoring = true;
        throw primary;
      });
      releases.push(() => init.mockRestore());
      const descriptors = vi
        .spyOn(Object, 'defineProperty')
        .mockImplementation((target, key, descriptor) => {
          const result = define(target, key, descriptor);
          if (restoring && target === navigator && key === 'locks')
            throw lockFailure;
          if (
            restoring &&
            target === HTMLElement.prototype &&
            key === 'scrollIntoView'
          )
            throw scrollFailure;
          return result;
        });
      releases.push(() => descriptors.mockRestore());
      let caught: { readonly error: unknown } | undefined;
      try {
        initializeNativeKeyboardSurface(secondary);
      } catch (error) {
        caught = { error };
      }
      expect(init).toHaveBeenCalledTimes(1);
      expect(caught).toBeDefined();
      expect(caught?.error).toBe(primary);
      expect(secondary).toEqual([
        { error: lockFailure },
        { error: scrollFailure },
      ]);
      expect(Object.getOwnPropertyDescriptor(navigator, 'locks')).toEqual(
        locks
      );
      expect(
        Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
      ).toEqual(scroll);
      expect(
        report.mock.calls.filter(([error]) => error === lockFailure)
      ).toHaveLength(1);
      expect(
        report.mock.calls.filter(([error]) => error === scrollFailure)
      ).toHaveLength(1);
    } catch (error) {
      testFailure = { error };
      throw error;
    } finally {
      restoring = false;
      for (const release of releases.reverse()) {
        try {
          release();
        } catch (error) {
          failures.push({ error });
        }
      }
      try {
        if (locks) define(navigator, 'locks', locks);
        else Reflect.deleteProperty(navigator, 'locks');
      } catch (error) {
        failures.push({ error });
      }
      try {
        if (scroll) define(HTMLElement.prototype, 'scrollIntoView', scroll);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      } catch (error) {
        failures.push({ error });
      }
    }
    if (!testFailure && failures.length) throw failures[0].error;
  }
);

test.each([undefined, null, { opaque: 'seed-primary' }])(
  'post-mount seed failure joins actual runtime close and retains independent raw cleanup causes %j',
  async (primary) => {
    const before = [...document.body.children];
    const secondary: NativeKeyboardCleanupFailure[] = [];
    const rootFailure = { opaque: 'root-cleanup' };
    const closeFailure = { opaque: 'runtime-close' };
    const gate = Promise.withResolvers<void>();
    const nativeClosed = Promise.withResolvers<void>();
    const originalClose = SessionExecutor.prototype.close;
    const originalRemove = Element.prototype.remove;
    let root: Element | undefined;
    let armed = true;
    let seeds = 0;
    let closes = 0;
    let settled: { readonly error: unknown } | undefined;
    let setup: Promise<void> | undefined;
    const releases: (() => void)[] = [];
    let testFailure: { readonly error: unknown } | undefined;
    const failures: NativeKeyboardCleanupFailure[] = [];
    try {
      const report = vi.spyOn(Telemetry, 'error').mockImplementation(() => {});
      releases.push(() => report.mockRestore());
      const seed = vi
        .spyOn(SessionPort.prototype, 'setState')
        .mockImplementation(() => {
          seeds++;
          root = [...document.body.children].find(
            (element) => !before.includes(element)
          );
          throw primary;
        });
      releases.push(() => seed.mockRestore());
      const close = vi
        .spyOn(SessionExecutor.prototype, 'close')
        .mockImplementation(function (
          this: SessionExecutor<native.EditorSession>
        ) {
          const pending = Reflect.apply(originalClose, this, []);
          if (!armed) return pending;
          closes++;
          return pending.then(async () => {
            nativeClosed.resolve();
            await gate.promise;
            throw closeFailure;
          });
        });
      releases.push(() => close.mockRestore());
      const remove = vi
        .spyOn(Element.prototype, 'remove')
        .mockImplementation(function (this: Element) {
          Reflect.apply(originalRemove, this, []);
          if (armed && this === root) throw rootFailure;
        });
      releases.push(() => remove.mockRestore());
      setup = nativeAcknowledgementSurface(
        undefined,
        undefined,
        secondary
      ).then(
        async (fixture) => {
          await fixture.close();
          throw new Error('Expected actual seed failure');
        },
        (error) => {
          settled = { error };
        }
      );
      await nativeClosed.promise;
      expect(seeds).toBe(1);
      expect(closes).toBe(1);
      expect(root).toBeDefined();
      expect(root?.isConnected).toBe(false);
      expect([...document.body.children]).toEqual(before);
      expect(settled).toBeUndefined(); // Close gate still belongs to setup.
      gate.resolve();
      await setup;
      expect(settled).toBeDefined();
      expect(settled?.error).toBe(primary);
      expect(secondary).toEqual([
        { error: rootFailure },
        { error: closeFailure },
      ]);
      expect(
        report.mock.calls.filter(([error]) => error === rootFailure)
      ).toHaveLength(1);
      expect(
        report.mock.calls.filter(([error]) => error === closeFailure)
      ).toHaveLength(1);
      armed = false;
      seed.mockRestore();
      const healthy = await nativeAcknowledgementSurface();
      try {
        expect(healthy.root.isConnected).toBe(true);
      } finally {
        await healthy.close();
      }
      expect([...document.body.children]).toEqual(before);
    } catch (error) {
      testFailure = { error };
      throw error;
    } finally {
      armed = false;
      gate.resolve();
      try {
        await setup;
      } catch (error) {
        failures.push({ error });
      }
      for (const release of releases.reverse()) {
        try {
          release();
        } catch (error) {
          failures.push({ error });
        }
      }
    }
    if (!testFailure && failures.length) throw failures[0].error;
  }
);
