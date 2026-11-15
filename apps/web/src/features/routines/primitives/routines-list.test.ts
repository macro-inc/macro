import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { RoutineListSource } from '../context/routine-sources';
import type { RoutineSnapshot } from '../core/routine';
import { createRoutineRows } from './routines-list';

function routine(
  id: string,
  createdAt: string,
  parent?: RoutineSnapshot['parent']
): RoutineSnapshot {
  return {
    id,
    name: id,
    ownerId: 'owner',
    createdAt,
    enabled: true,
    revision: 1,
    configurationKey: id,
    parent,
  };
}

function source(
  routines: RoutineSnapshot[],
  subRoutines: RoutineSnapshot[]
): RoutineListSource {
  return {
    routines: () => routines,
    subRoutines: () => subRoutines,
    loading: () => false,
    error: () => false,
    refresh: async () => undefined,
    setEnabled: () => undefined,
    pendingId: () => undefined,
  };
}

const PARENT = routine('parent', '2026-11-01T00:00:00Z');
const OTHER = routine('other', '2026-11-02T00:00:00Z');
const CHILDREN = [
  routine('older child', '2026-11-03T00:00:00Z', {
    id: 'parent',
    createdByRunId: 'run-1',
    pausedByParent: false,
  }),
  routine('newer child', '2026-11-04T00:00:00Z', {
    id: 'parent',
    createdByRunId: 'run-2',
    pausedByParent: true,
  }),
];

describe('createRoutineRows', () => {
  it('nests what a routine’s runs created under it, newest first', () => {
    createRoot((dispose) => {
      const rows = createRoutineRows(
        source([PARENT, OTHER], CHILDREN),
        () => 'owner'
      );

      expect(rows().map((row) => row.id)).toEqual(['other', 'parent']);
      const [other, parent] = rows();
      expect(other?.children).toEqual([]);
      expect(parent?.children.map((child) => child.id)).toEqual([
        'newer child',
        'older child',
      ]);
      expect(parent?.children.map((child) => child.pausedByParent)).toEqual([
        true,
        false,
      ]);
      dispose();
    });
  });

  it('lists top-level routines only where rows are not nested', () => {
    createRoot((dispose) => {
      const rows = createRoutineRows(
        source([PARENT, OTHER], CHILDREN),
        () => 'owner',
        () => false
      );

      expect(rows().map((row) => row.id)).toEqual(['other', 'parent']);
      expect(rows().flatMap((row) => row.children)).toEqual([]);
      dispose();
    });
  });
});
