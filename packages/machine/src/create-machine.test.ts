import { createComputed, createRoot, createSignal, onCleanup } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  createMachine,
  DispatchCycleError,
  MAX_CHAINED_DISPATCHES,
  type MachineDef,
} from './create-machine';

type S = { t: 'a' } | { t: 'b'; n: number } | { t: 'c' };
type E =
  | { t: 'go-b'; n: number }
  | { t: 'go-c' }
  | { t: 'go-a' }
  | { t: 'noop' };
type C = { t: 'cmd'; n: number };

const def: MachineDef<S, E, C> = {
  a: {
    on: (_s, e) =>
      e.t === 'go-b'
        ? { state: { t: 'b', n: e.n }, commands: [{ t: 'cmd', n: e.n }] }
        : undefined,
  },
  b: {
    on: (s, e) => {
      switch (e.t) {
        case 'go-b':
          return { state: { t: 'b', n: e.n } };
        case 'go-c':
          return { state: { t: 'c' }, commands: [{ t: 'cmd', n: s.n }] };
        default:
          return undefined;
      }
    },
  },
  c: { on: (_s, e) => (e.t === 'go-a' ? { state: { t: 'a' } } : undefined) },
};

const run = <T>(fn: (dispose: () => void) => T) => createRoot(fn);

describe('createMachine', () => {
  it('starts in the initial state and applies transitions', () =>
    run((dispose) => {
      const m = createMachine({ initial: { t: 'a' } as S, def });
      expect(m.state()).toEqual({ t: 'a' });
      m.dispatch({ t: 'go-b', n: 1 });
      expect(m.state()).toEqual({ t: 'b', n: 1 });
      dispose();
    }));

  it('reports ignored events to inspect and leaves state untouched', () =>
    run((dispose) => {
      const inspect = vi.fn();
      const m = createMachine({ initial: { t: 'a' } as S, def, inspect });
      m.dispatch({ t: 'noop' });
      expect(m.state()).toEqual({ t: 'a' });
      expect(inspect).toHaveBeenCalledWith(
        { t: 'a' },
        { t: 'noop' },
        'ignored'
      );
      dispose();
    }));

  it('executes commands in order after the state has changed', () =>
    run((dispose) => {
      const seen: Array<[C, S]> = [];
      const m = createMachine<S, E, C>({
        initial: { t: 'a' },
        def,
        execute: (cmd) => seen.push([cmd, m.state()]),
      });
      m.dispatch({ t: 'go-b', n: 7 });
      expect(seen).toEqual([
        [
          { t: 'cmd', n: 7 },
          { t: 'b', n: 7 },
        ],
      ]);
      dispose();
    }));

  describe('scopes', () => {
    it('mounts on entry, disposes on exit, and exposes the returned value', () =>
      run((dispose) => {
        const log: string[] = [];
        const m = createMachine<S, E, C, string>({
          initial: { t: 'a' },
          def,
          scopes: {
            b: (s) => {
              log.push(`enter b ${s.n}`);
              onCleanup(() => log.push(`leave b ${s.n}`));
              return `value ${s.n}`;
            },
          },
        });
        expect(m.value()).toBeUndefined();
        m.dispatch({ t: 'go-b', n: 1 });
        expect(m.value()).toBe('value 1');
        m.dispatch({ t: 'go-c' });
        expect(m.value()).toBeUndefined();
        expect(log).toEqual(['enter b 1', 'leave b 1']);
        dispose();
      }));

    it('remounts on a self-transition with a new payload', () =>
      run((dispose) => {
        const log: string[] = [];
        const m = createMachine<S, E, C, void>({
          initial: { t: 'b', n: 1 },
          def,
          scopes: {
            b: (s) => {
              log.push(`enter ${s.n}`);
              onCleanup(() => log.push(`leave ${s.n}`));
            },
          },
        });
        m.dispatch({ t: 'go-b', n: 2 });
        expect(log).toEqual(['enter 1', 'leave 1', 'enter 2']);
        dispose();
      }));

    it('runs the outgoing cleanup while state() still reads the old state', () =>
      run((dispose) => {
        let seenOnLeave: S | undefined;
        const m = createMachine<S, E, C, void>({
          initial: { t: 'b', n: 1 },
          def,
          scopes: {
            b: () => {
              onCleanup(() => {
                seenOnLeave = m.state();
              });
            },
          },
        });
        m.dispatch({ t: 'go-c' });
        expect(seenOnLeave).toEqual({ t: 'b', n: 1 });
        dispose();
      }));

    it('mounts the initial state scope and drains events it dispatches', () =>
      run((dispose) => {
        const m = createMachine<S, E, C, void>({
          initial: { t: 'a' },
          def,
          scopes: {
            a: (_s, dispatch) => {
              dispatch({ t: 'go-b', n: 3 });
            },
          },
        });
        expect(m.state()).toEqual({ t: 'b', n: 3 });
        dispose();
      }));

    it('disposes the current scope when the owner is disposed', () =>
      run((dispose) => {
        const left = vi.fn();
        createMachine<S, E, C, void>({
          initial: { t: 'b', n: 1 },
          def,
          scopes: { b: () => onCleanup(left) },
        });
        dispose();
        expect(left).toHaveBeenCalledOnce();
      }));

    it('scope-internal reactivity is disposed with the scope', () =>
      run((dispose) => {
        const [sig, setSig] = createSignal(0);
        const reads: number[] = [];
        const m = createMachine<S, E, C, void>({
          initial: { t: 'b', n: 1 },
          def,
          scopes: {
            b: () => {
              const stop = watch(sig, (v) => reads.push(v));
              onCleanup(stop);
            },
          },
        });
        setSig(1);
        m.dispatch({ t: 'go-c' });
        setSig(2);
        expect(reads).toEqual([0, 1]);
        dispose();
      }));
  });

  describe('dispatch serialization', () => {
    it('queues a dispatch made from inside a scope until the transition completes', () =>
      run((dispose) => {
        const order: string[] = [];
        const m = createMachine<S, E, C, void>({
          initial: { t: 'a' },
          def,
          scopes: {
            b: (_s, dispatch) => {
              order.push('b mounted');
              dispatch({ t: 'go-c' });
              order.push('b scope done');
            },
            c: () => {
              order.push('c mounted');
            },
          },
        });
        m.dispatch({ t: 'go-b', n: 1 });
        expect(order).toEqual(['b mounted', 'b scope done', 'c mounted']);
        expect(m.state()).toEqual({ t: 'c' });
        dispose();
      }));

    it('queues a dispatch made from a command', () =>
      run((dispose) => {
        const m = createMachine<S, E, C>({
          initial: { t: 'a' },
          def,
          execute: (cmd, dispatch) => {
            if (cmd.n === 1) dispatch({ t: 'go-c' });
          },
        });
        m.dispatch({ t: 'go-b', n: 1 });
        expect(m.state()).toEqual({ t: 'c' });
        dispose();
      }));

    it('queues a dispatch made from a cleanup', () =>
      run((dispose) => {
        const m = createMachine<S, E, C, void>({
          initial: { t: 'b', n: 1 },
          def,
          scopes: {
            b: (_s, dispatch) => {
              onCleanup(() => dispatch({ t: 'go-a' }));
            },
          },
        });
        m.dispatch({ t: 'go-c' });
        expect(m.state()).toEqual({ t: 'a' });
        dispose();
      }));

    it('throws DispatchCycleError with a trail on a dispatch cycle', () =>
      run((dispose) => {
        type L = { t: 'x' } | { t: 'y' };
        type LE = { t: 'flip' };
        const loop: MachineDef<L, LE> = {
          x: { on: () => ({ state: { t: 'y' } }) },
          y: { on: () => ({ state: { t: 'x' } }) },
        };
        const build = () =>
          createMachine<L, LE, never, void>({
            initial: { t: 'x' },
            def: loop,
            scopes: {
              x: (_s, dispatch) => dispatch({ t: 'flip' }),
              y: (_s, dispatch) => dispatch({ t: 'flip' }),
            },
          });
        expect(build).toThrow(DispatchCycleError);
        try {
          build();
        } catch (err) {
          const trail = (err as DispatchCycleError).trail;
          expect(trail.length).toBeGreaterThan(0);
          expect(trail.length).toBeLessThanOrEqual(20);
          expect(trail.every((e) => (e as LE).t === 'flip')).toBe(true);
        }
        expect(MAX_CHAINED_DISPATCHES).toBe(1000);
        dispose();
      }));

    it('is a no-op after the owner is disposed', () =>
      run((dispose) => {
        const m = createMachine({ initial: { t: 'a' } as S, def });
        dispose();
        m.dispatch({ t: 'go-b', n: 1 });
        expect(m.state()).toEqual({ t: 'a' });
        dispose();
      }));
  });

  it('matches narrows to the current state or undefined', () =>
    run((dispose) => {
      const m = createMachine({ initial: { t: 'b', n: 4 } as S, def });
      expect(m.matches('b')?.n).toBe(4);
      expect(m.matches('a')).toBeUndefined();
      dispose();
    }));
});

function watch<T>(read: () => T, cb: (v: T) => void): () => void {
  let active = true;
  createComputed(() => {
    const v = read();
    if (active) cb(v);
  });
  return () => {
    active = false;
  };
}
