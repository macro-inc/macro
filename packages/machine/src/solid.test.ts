// @vitest-environment jsdom
import {
  createComponent,
  createComputed,
  createContext,
  createRoot,
  createSignal,
  onCleanup,
  useContext,
} from 'solid-js';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { MachineDef } from './index';
import { createSolidMachine, type SolidMachine, solidScope } from './solid';

type S = { t: 'idle' } | { t: 'active'; id: number };
type E = { t: 'start'; id: number } | { t: 'stop' };
type C = { t: 'started' };

const def: MachineDef<S, E, C> = {
  idle: {
    on: (_state, event) =>
      event.t === 'start'
        ? { state: { t: 'active', id: event.id }, commands: [{ t: 'started' }] }
        : undefined,
  },
  active: {
    on: (_state, event) => ({
      state:
        event.t === 'start' ? { t: 'active', id: event.id } : { t: 'idle' },
    }),
  },
};

function run<T>(fn: (dispose: () => void) => T) {
  return createRoot((dispose) => {
    onTestFinished(dispose);
    return fn(dispose);
  });
}

describe('createSolidMachine', () => {
  it('publishes reactive snapshots and narrowed matches before commands run', () =>
    run(() => {
      const observed: Array<number | undefined> = [];
      const commands: S[] = [];
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'idle' },
        def,
        execute: () => commands.push(machine.state()),
      });
      createComputed(() => observed.push(machine.matches('active')?.id));
      machine.dispatch({ t: 'start', id: 7 });
      machine.dispatch({ t: 'start', id: 8 });
      machine.dispatch({ t: 'stop' });
      expect(observed).toEqual([undefined, 7, 8, undefined]);
      expect(commands).toEqual([{ t: 'active', id: 7 }]);
      expect(machine.matches('idle')).toEqual({ t: 'idle' });
    }));

  it('initializes the signal from the settled initial scope', () =>
    run(() => {
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'idle' },
        def,
        scopes: { idle: (_state, dispatch) => dispatch({ t: 'start', id: 2 }) },
      });
      expect(machine.state()).toEqual({ t: 'active', id: 2 });
    }));

  it('queues dispatches from reactive consumers until commands finish', () =>
    run(() => {
      const commands: S[] = [];
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'idle' },
        def,
        execute: () => commands.push(machine.state()),
      });
      createComputed(() => {
        if (machine.matches('active')) machine.dispatch({ t: 'stop' });
      });
      machine.dispatch({ t: 'start', id: 1 });
      expect(commands).toEqual([{ t: 'active', id: 1 }]);
      expect(machine.state()).toEqual({ t: 'idle' });
    }));

  it('does not subscribe a dispatch caller to signals read by callbacks', () =>
    run(() => {
      const [trigger, setTrigger] = createSignal(0);
      const [external, setExternal] = createSignal(0);
      let runs = 0;
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'idle' },
        def,
        inspect: () => {
          external();
        },
      });
      createComputed(() => {
        runs++;
        machine.dispatch({ t: 'start', id: trigger() });
      });
      setExternal(1);
      expect(runs).toBe(1);
      setTrigger(1);
      expect(runs).toBe(2);
    }));

  it('disposes with its owner and ignores later dispatches', () =>
    run((dispose) => {
      const cleanup = vi.fn();
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'active', id: 1 },
        def,
        scopes: { active: () => cleanup },
      });
      dispose();
      machine.dispatch({ t: 'stop' });
      machine.dispose();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(machine.state()).toEqual({ t: 'active', id: 1 });
    }));

  it('supports explicit disposal without a Solid owner', () => {
    const cleanup = vi.fn();
    const machine = createSolidMachine<S, E, C>({
      initial: { t: 'active', id: 1 },
      def,
      scopes: { active: () => cleanup },
    });
    onTestFinished(machine.dispose);
    machine.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

describe('solidScope', () => {
  it('registers cleanup once when a callback returns onCleanup directly', () =>
    run((dispose) => {
      const cleanup = vi.fn();
      createSolidMachine<S, E, C>({
        initial: { t: 'active', id: 1 },
        def,
        scopes: { active: solidScope(() => onCleanup(cleanup)) },
      });
      dispose();
      expect(cleanup).toHaveBeenCalledOnce();
    }));

  it('reads the current state during entry before subscribers are notified', () =>
    run(() => {
      let seen: S | undefined;
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'idle' },
        def,
        scopes: {
          active: solidScope(() => {
            seen = machine.state();
          }),
        },
      });
      machine.dispatch({ t: 'start', id: 1 });
      expect(seen).toEqual({ t: 'active', id: 1 });
    }));

  it('disposes computations on exit and recreates them for a fresh payload', () =>
    run((dispose) => {
      const [input, setInput] = createSignal(0);
      const reads: Array<[number, number]> = [];
      const cleanup = vi.fn();
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'active', id: 1 },
        def,
        scopes: {
          active: solidScope((state) => {
            createComputed(() => reads.push([state.id, input()]));
            onCleanup(cleanup);
          }),
        },
      });
      setInput(1);
      machine.dispatch({ t: 'start', id: 2 });
      setInput(2);
      machine.dispatch({ t: 'stop' });
      setInput(3);
      dispose();
      expect(reads).toEqual([
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 2],
      ]);
      expect(cleanup).toHaveBeenCalledTimes(2);
    }));

  it('runs outgoing Solid cleanup while the adapter still reads the old state', () =>
    run(() => {
      let seen: S | undefined;
      const machine = createSolidMachine<S, E, C>({
        initial: { t: 'active', id: 1 },
        def,
        scopes: {
          active: solidScope(() => {
            onCleanup(() => {
              seen = machine.state();
            });
          }),
        },
      });
      machine.dispatch({ t: 'stop' });
      expect(seen).toEqual({ t: 'active', id: 1 });
    }));

  it('captures context from configuration, even when dispatched outside it', () => {
    const Context = createContext('default');
    const seen: string[] = [];
    const machine = run(() => {
      let machine!: SolidMachine<S, E>;
      createComponent(Context.Provider, {
        value: 'configured',
        get children() {
          machine = createSolidMachine<S, E, C>({
            initial: { t: 'idle' },
            def,
            scopes: {
              active: solidScope(() => {
                seen.push(useContext(Context));
              }),
            },
          });
          return null;
        },
      });
      return machine;
    });
    machine.dispatch({ t: 'start', id: 1 });
    expect(seen).toEqual(['configured']);
  });

  it('cleans up a Solid root if its callback throws during construction', () =>
    run(() => {
      const cleanup = vi.fn();
      expect(() =>
        createSolidMachine<S, E, C>({
          initial: { t: 'active', id: 1 },
          def,
          scopes: {
            active: solidScope(() => {
              onCleanup(cleanup);
              throw new Error('scope failed');
            }),
          },
        })
      ).toThrow('scope failed');
      expect(cleanup).toHaveBeenCalledOnce();
    }));
});
