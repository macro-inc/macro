import { describe, expect, test, vi } from 'vitest';
import { createHotkeyGroup } from './hotkeys';
import type { RegisterHotkeyReturn } from './types';

const makeRegistration = (): RegisterHotkeyReturn => {
  const reg: RegisterHotkeyReturn = {
    dispose: vi.fn(),
    withGroup: (group) => {
      group.add(reg);
      return reg;
    },
  };
  return reg;
};

describe('createHotkeyGroup', () => {
  test('add returns the registration unchanged', () => {
    const group = createHotkeyGroup();
    const reg = makeRegistration();
    expect(group.add(reg)).toBe(reg);
  });

  test('dispose disposes every added registration', () => {
    const group = createHotkeyGroup();
    const a = makeRegistration();
    const b = makeRegistration();
    group.add(a);
    group.add(b);

    group.dispose();

    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);
  });

  test('addDisposer runs arbitrary cleanup on dispose', () => {
    const group = createHotkeyGroup();
    const cleanup = vi.fn();
    group.addDisposer(cleanup);

    group.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('runs disposers in insertion order across add and addDisposer', () => {
    const group = createHotkeyGroup();
    const calls: string[] = [];

    const a = makeRegistration();
    (a.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls.push('a');
    });

    group.add(a);
    group.addDisposer(() => calls.push('mid'));

    const b = makeRegistration();
    (b.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls.push('b');
    });
    group.add(b);

    group.dispose();

    expect(calls).toEqual(['a', 'mid', 'b']);
  });

  test('dispose is idempotent — second call is a no-op', () => {
    const group = createHotkeyGroup();
    const reg = makeRegistration();
    const cleanup = vi.fn();

    group.add(reg);
    group.addDisposer(cleanup);

    group.dispose();
    group.dispose();

    expect(reg.dispose).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('withGroup routes through add', () => {
    const group = createHotkeyGroup();
    const reg = makeRegistration();

    reg.withGroup(group);
    group.dispose();

    expect(reg.dispose).toHaveBeenCalledTimes(1);
  });
});
