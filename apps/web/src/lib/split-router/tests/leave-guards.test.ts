import { describe, expect, it, vi } from 'vitest';
import type { PaneId } from '../panes/types';
import { createLeaveGuards } from '../router/leave-guards';

const PANE = 'pane' as PaneId;
const OTHER_PANE = 'another-pane' as PaneId;

describe('parent draft leave guards', () => {
  it('opts into child navigation without changing ordinary parent guards', () => {
    const guards = createLeaveGuards();
    const ordinary = vi.fn(() => true);
    const draft = vi.fn(() => true);
    const child = vi.fn(() => true);
    guards.register(PANE, 0, ordinary);
    guards.register(PANE, 0, draft, { descendants: true });
    guards.register(PANE, 1, child);
    expect(guards.select(PANE, 1)).toEqual([draft, child]);
    expect(guards.select(OTHER_PANE, 1)).toEqual([]);
    expect(guards.select(PANE, undefined)).toEqual([]);
  });

  it('continues to guard pane closure and unregisters on disposal', () => {
    const guards = createLeaveGuards();
    const draft = vi.fn(() => true);
    const remove = guards.register(PANE, 0, draft, { descendants: true });
    expect(guards.select(PANE, -1)).toEqual([draft]);
    remove();
    expect(guards.select(PANE, -1)).toEqual([]);
  });
});
