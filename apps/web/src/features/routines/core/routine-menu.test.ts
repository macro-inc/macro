import { describe, expect, it } from 'vitest';
import {
  canRunRoutine,
  canToggleRoutine,
  type RoutineMenuSurface,
  routineMenuGroups,
} from './routine-menu';

const DESKTOP: RoutineMenuSurface = {
  nested: false,
  splits: true,
  tabs: true,
  share: true,
};

describe('routine menu groups', () => {
  it('offers its owner opening, running, copying, links and delete', () => {
    expect(
      routineMenuGroups({ editable: true, enabled: true }, DESKTOP)
    ).toEqual([
      ['open-in-split', 'open-in-tab'],
      ['run-now', 'turn-off'],
      ['duplicate'],
      ['copy-link', 'copy-id', 'share'],
      ['delete'],
    ]);
  });

  it('turns a paused routine on', () => {
    expect(
      routineMenuGroups({ editable: true, enabled: false }, DESKTOP)[1]
    ).toEqual(['run-now', 'turn-on']);
  });

  it('keeps a sub-routine as the owner’s own', () => {
    expect(
      routineMenuGroups(
        { editable: true, enabled: true },
        { ...DESKTOP, nested: true }
      )[2]
    ).toEqual(['duplicate', 'keep']);
  });

  it('leaves out what the host cannot offer', () => {
    expect(
      routineMenuGroups(
        { editable: true, enabled: true },
        { nested: false, splits: false, tabs: false, share: false }
      )
    ).toEqual([
      ['run-now', 'turn-off'],
      ['duplicate'],
      ['copy-link', 'copy-id'],
      ['delete'],
    ]);
  });

  it('gives everyone else opening and links only', () => {
    expect(
      routineMenuGroups(
        { editable: false, enabled: true },
        { ...DESKTOP, nested: true }
      )
    ).toEqual([
      ['open-in-split', 'open-in-tab'],
      ['copy-link', 'copy-id'],
    ]);
  });
});

describe('routine menu availability', () => {
  const row = {
    editable: true,
    enabled: true,
    status: 'Active' as const,
  };

  it('switches like the row’s switch', () => {
    expect(canToggleRoutine(row, false)).toBe(true);
    expect(canToggleRoutine(row, true)).toBe(false);
    expect(canToggleRoutine({ ...row, editable: false }, false)).toBe(false);
    expect(
      canToggleRoutine({ ...row, enabled: false, status: 'Paused' }, false)
    ).toBe(true);
    expect(
      canToggleRoutine({ ...row, enabled: false, status: 'Running' }, false)
    ).toBe(false);
    expect(
      canToggleRoutine({ ...row, enabled: false, status: 'Completed' }, false)
    ).toBe(false);
    expect(canToggleRoutine({ ...row, status: 'Running' }, false)).toBe(true);
  });

  it('runs one at a time, paused or not', () => {
    const paused = { ...row, enabled: false, status: 'Paused' as const };
    expect(canRunRoutine(row, false)).toBe(true);
    expect(canRunRoutine(paused, false)).toBe(true);
    expect(canRunRoutine(row, true)).toBe(false);
    expect(canRunRoutine({ ...row, status: 'Running' }, false)).toBe(false);
    expect(canRunRoutine({ ...row, editable: false }, false)).toBe(false);
  });
});
