import { describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  createMachine,
  DispatchCycleError,
  MAX_CHAINED_DISPATCHES,
  type MachineDef,
  type MachineOptions,
} from './index';

// Importing the public core entry point must never load Solid.
vi.mock('solid-js', () => {
  throw new Error('The machine core must not import Solid');
});

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

function create(options: Partial<MachineOptions<S, E, C>> = {}) {
  const machine = createMachine<S, E, C>({
    initial: { t: 'a' },
    def,
    ...options,
  });
  onTestFinished(machine.dispose);
  return machine;
}

describe('createMachine', () => {
  it('runs without a Solid owner or a DOM', () => {
    expect(typeof document).toBe('undefined');
    const machine = create();
    expect(machine.getState()).toEqual({ t: 'a' });
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(machine.getState()).toEqual({ t: 'b', n: 1 });
  });

  it('reports ignored events without notifying or restarting the scope', () => {
    const inspect = vi.fn();
    const cleanup = vi.fn();
    const scope = vi.fn(() => cleanup);
    const listener = vi.fn();
    const machine = create({ inspect, scopes: { a: scope } });
    const initial = machine.getState();
    machine.subscribe(listener);
    machine.dispatch({ t: 'noop' });
    expect(inspect).toHaveBeenCalledWith(initial, { t: 'noop' }, 'ignored');
    expect(machine.getState()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();
    expect(scope).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('cleans up, enters, publishes, and executes commands in order', () => {
    const order: string[] = [];
    const machine = create({
      def: {
        ...def,
        a: {
          on: () => ({
            state: { t: 'b', n: 7 },
            commands: [
              { t: 'cmd', n: 1 },
              { t: 'cmd', n: 2 },
            ],
          }),
        },
      },
      scopes: {
        a: () => () => {
          order.push(`leave ${machine.getState().t}`);
        },
        b: () => {
          order.push('enter b');
        },
      },
      execute: (cmd) => {
        order.push(`command ${cmd.n} in ${machine.getState().t}`);
      },
    });
    machine.subscribe((state) => order.push(`notify ${state.t}`));
    machine.dispatch({ t: 'go-b', n: 7 });
    expect(order).toEqual([
      'leave a',
      'enter b',
      'notify b',
      'command 1 in b',
      'command 2 in b',
    ]);
  });

  it('restarts scopes on same-tag transitions with a fresh payload', () => {
    const log: string[] = [];
    const machine = create({
      initial: { t: 'b', n: 1 },
      scopes: {
        b: (state) => {
          log.push(`enter ${state.n}`);
          return () => {
            log.push(`leave ${state.n}`);
          };
        },
      },
    });
    machine.dispatch({ t: 'go-b', n: 2 });
    machine.dispose();
    expect(log).toEqual(['enter 1', 'leave 1', 'enter 2', 'leave 2']);
  });

  it('restarts even when an accepted transition returns the same object', () => {
    const cleanup = vi.fn();
    const scope = vi.fn(() => cleanup);
    const machine = create({
      def: { ...def, a: { on: (state) => ({ state }) } },
      scopes: { a: scope },
    });
    const listener = vi.fn();
    machine.subscribe(listener);
    machine.dispatch({ t: 'noop' });
    expect(scope).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(machine.getState());
  });

  it('finishes the initial scope before draining its events', () => {
    const order: string[] = [];
    const machine = create({
      scopes: {
        a: (_state, dispatch) => {
          dispatch({ t: 'go-b', n: 3 });
          order.push('initial mounted');
          return () => {
            order.push('initial cleaned up');
          };
        },
        b: () => {
          order.push('b mounted');
        },
      },
    });
    expect(machine.getState()).toEqual({ t: 'b', n: 3 });
    expect(order).toEqual([
      'initial mounted',
      'initial cleaned up',
      'b mounted',
    ]);
  });

  it('queues events from scopes until scope entry and commands finish', () => {
    const order: string[] = [];
    const machine = create({
      scopes: {
        b: (_state, dispatch) => {
          dispatch({ t: 'go-c' });
          order.push('b mounted');
        },
        c: () => {
          order.push('c mounted');
        },
      },
      execute: () => {
        order.push(`command in ${machine.getState().t}`);
      },
    });
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(order).toEqual([
      'b mounted',
      'command in b',
      'c mounted',
      'command in c',
    ]);
  });

  it('queues events from commands', () => {
    const machine = create({
      execute: (cmd, dispatch) => {
        if (cmd.n === 1) dispatch({ t: 'go-c' });
      },
    });
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(machine.getState()).toEqual({ t: 'c' });
  });

  it('queues events from outgoing cleanups', () => {
    const machine = create({
      initial: { t: 'b', n: 1 },
      scopes: {
        b: (_state, dispatch) => () => dispatch({ t: 'go-a' }),
      },
    });
    machine.dispatch({ t: 'go-c' });
    expect(machine.getState()).toEqual({ t: 'a' });
  });

  it('finishes notifying all subscribers before processing their events', () => {
    const order: string[] = [];
    const machine = create();
    machine.subscribe((state) => {
      order.push(`first ${state.t}`);
      if (state.t === 'b') machine.dispatch({ t: 'go-c' });
    });
    machine.subscribe((state) => {
      order.push(`second ${state.t} reads ${machine.getState().t}`);
    });
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(order).toEqual([
      'first b',
      'second b reads b',
      'first c',
      'second c reads c',
    ]);
  });

  it('subscribes to future transitions and stops on unsubscribe', () => {
    const machine = create();
    const listener = vi.fn();
    const unsubscribe = machine.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
    machine.dispatch({ t: 'go-b', n: 4 });
    unsubscribe();
    unsubscribe();
    machine.dispatch({ t: 'go-c' });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ t: 'b', n: 4 });
  });

  it('defers new subscribers and respects unsubscribe during notification', () => {
    const machine = create();
    const removed = vi.fn();
    const added = vi.fn();
    machine.subscribe(() => {
      unsubscribe();
      machine.subscribe(added);
    });
    const unsubscribe = machine.subscribe(removed);
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(removed).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    machine.dispatch({ t: 'go-c' });
    expect(added).toHaveBeenCalledExactlyOnceWith({ t: 'c' });
  });

  it('disposes once and ignores cleanup, late, and queued dispatches', () => {
    const cleanup = vi.fn();
    const machine = create({
      initial: { t: 'b', n: 1 },
      scopes: {
        b: (_state, dispatch) => () => {
          cleanup();
          dispatch({ t: 'go-c' });
        },
      },
    });
    const listener = vi.fn();
    machine.subscribe(listener);
    machine.dispose();
    machine.dispose();
    machine.subscribe(listener);
    machine.dispatch({ t: 'go-c' });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(machine.getState()).toEqual({ t: 'b', n: 1 });
  });

  it('cancels a timer when its state is left or its machine is disposed', () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const machine = create({
      initial: { t: 'b', n: 1 },
      scopes: {
        b: (_state, dispatch) => {
          const timer = setTimeout(() => dispatch({ t: 'go-c' }), 100);
          return () => clearTimeout(timer);
        },
      },
    });
    machine.dispatch({ t: 'go-b', n: 2 });
    expect(vi.getTimerCount()).toBe(1);
    machine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(machine.getState()).toEqual({ t: 'b', n: 2 });
  });

  it('stops a transition if its outgoing cleanup disposes the machine', () => {
    const entered = vi.fn();
    const execute = vi.fn();
    const machine = create({
      scopes: {
        a: () => () => machine.dispose(),
        b: entered,
      },
      execute,
    });
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(machine.getState()).toEqual({ t: 'a' });
    expect(entered).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('releases cleanup returned after a scope disposes the machine', () => {
    const cleanup = vi.fn();
    const execute = vi.fn();
    const machine = create({
      scopes: {
        b: () => {
          machine.dispose();
          return cleanup;
        },
      },
      execute,
    });
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it('stops notifications, commands, and queued events on subscriber disposal', () => {
    const execute = vi.fn();
    const nextListener = vi.fn();
    const machine = create({ execute });
    machine.subscribe(() => {
      machine.dispatch({ t: 'go-c' });
      machine.dispose();
    });
    machine.subscribe(nextListener);
    machine.dispatch({ t: 'go-b', n: 1 });
    expect(nextListener).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(machine.getState()).toEqual({ t: 'b', n: 1 });
  });

  it('discards queued events after a command throws', () => {
    const machine = create({
      execute: (_cmd, dispatch) => {
        dispatch({ t: 'go-c' });
        throw new Error('command failed');
      },
    });
    expect(() => machine.dispatch({ t: 'go-b', n: 1 })).toThrow(
      'command failed'
    );
    machine.dispatch({ t: 'noop' });
    expect(machine.getState()).toEqual({ t: 'b', n: 1 });
  });

  it('reports a dispatch cycle and cleans up when construction fails', () => {
    type L = { t: 'x' } | { t: 'y' };
    type LE = { t: 'flip' };
    const loop: MachineDef<L, LE> = {
      x: { on: () => ({ state: { t: 'y' } }) },
      y: { on: () => ({ state: { t: 'x' } }) },
    };
    let entered = 0;
    let cleanedUp = 0;
    const scope = (_state: L, dispatch: (event: LE) => void) => {
      entered++;
      dispatch({ t: 'flip' });
      return () => {
        cleanedUp++;
      };
    };
    let error: unknown;
    try {
      createMachine<L, LE>({
        initial: { t: 'x' },
        def: loop,
        scopes: { x: scope, y: scope },
      });
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(DispatchCycleError);
    const trail = (error as DispatchCycleError).trail;
    expect(trail.length).toBeGreaterThan(0);
    expect(trail.length).toBeLessThanOrEqual(20);
    expect(trail.every((event) => (event as LE).t === 'flip')).toBe(true);
    expect(entered).toBe(MAX_CHAINED_DISPATCHES + 1);
    expect(cleanedUp).toBe(entered);
  });
});
