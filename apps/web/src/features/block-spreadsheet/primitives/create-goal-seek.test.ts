import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpreadsheetCell } from '../core/spreadsheet-document';
import { createGoalSeek, type GoalSeekSheet } from './create-goal-seek';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
});

function setup(options?: {
  activeAddress?: string;
  cells?: Record<string, SpreadsheetCell>;
  sheets?: GoalSeekSheet[];
}) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [revision, setRevision] = createSignal(1);
    const cells = options?.cells ?? {
      A1: { value: '2' },
      B1: { value: '=A1*5' },
    };
    const applied: { sheetId: string; address: string; value: string }[] = [];
    const selected: { sheetId: string; address: string }[] = [];
    const seek = vi.fn(async () => ({
      status: 'found' as const,
      input: '10',
      value: 10,
      result: 50,
      evaluations: 4,
      setSheetId: 'sheet1',
      setAddress: 'B1',
      changeSheetId: 'sheet1',
      changeAddress: 'A1',
    }));
    const goalSeek = createGoalSeek({
      sheets: () =>
        options?.sheets ?? [
          { id: 'sheet1', name: 'Plan' },
          { id: 'other', name: 'Other' },
        ],
      activeSheetId: () => 'sheet1',
      activeAddress: () => options?.activeAddress ?? 'B1',
      cell: (_sheetId, address) => cells[address],
      canEdit: () => true,
      revision,
      seek,
      apply: (sheetId, address, value) => {
        applied.push({ sheetId, address, value });
      },
      select: (sheetId, address) => {
        selected.push({ sheetId, address });
      },
    });
    return { goalSeek, seek, applied, selected, setRevision };
  });
}

describe('goal seek dialog state', () => {
  it('starts from the active formula and writes the solution', async () => {
    const { goalSeek, seek, applied, selected } = setup();
    goalSeek.show();
    expect(goalSeek.open()).toBe(true);
    expect(goalSeek.setCell()).toBe('B1');
    expect(goalSeek.changingCell()).toBe('');
    goalSeek.setChangingCell('A1');
    goalSeek.setGoal('50');
    await goalSeek.seek();
    expect(seek).toHaveBeenCalledWith({
      setSheetId: 'sheet1',
      setAddress: 'B1',
      goal: 50,
      changeSheetId: 'sheet1',
      changeAddress: 'A1',
    });
    expect(goalSeek.solution()?.status).toBe('found');
    goalSeek.apply();
    expect(applied).toEqual([
      { sheetId: 'sheet1', address: 'A1', value: '10' },
    ]);
    expect(selected).toEqual([{ sheetId: 'sheet1', address: 'A1' }]);
    expect(goalSeek.open()).toBe(false);
  });

  it('keeps a value cell as the changing cell and accepts a percent goal on another sheet', async () => {
    const { goalSeek, seek } = setup({ activeAddress: 'A1' });
    goalSeek.show();
    expect(goalSeek.setCell()).toBe('');
    expect(goalSeek.changingCell()).toBe('A1');
    goalSeek.setSetCell('Other!B2');
    goalSeek.setGoal('12%');
    await goalSeek.seek();
    expect(seek).toHaveBeenCalledWith({
      setSheetId: 'other',
      setAddress: 'B2',
      goal: 0.12,
      changeSheetId: 'sheet1',
      changeAddress: 'A1',
    });
  });

  it('discards a solution when the sheet changes during the search', async () => {
    const { goalSeek, setRevision, applied } = setup();
    goalSeek.show();
    goalSeek.setChangingCell('A1');
    goalSeek.setGoal('50');
    const pending = goalSeek.seek();
    setRevision(2);
    await pending;
    expect(goalSeek.solution()).toBeUndefined();
    expect(goalSeek.message()).toMatch(/changed/i);
    goalSeek.apply();
    expect(applied).toEqual([]);
  });

  it('does not write a solution after the sheet changes', async () => {
    const { goalSeek, setRevision, applied } = setup();
    goalSeek.show();
    goalSeek.setChangingCell('A1');
    goalSeek.setGoal('50');
    await goalSeek.seek();
    setRevision(2);
    goalSeek.apply();
    expect(applied).toEqual([]);
    expect(goalSeek.open()).toBe(true);
    expect(goalSeek.message()).toMatch(/changed/i);
  });

  it('explains an address or goal the search cannot use', async () => {
    const { goalSeek, seek } = setup();
    goalSeek.show();
    goalSeek.setGoal('lots');
    goalSeek.setChangingCell('A1');
    await goalSeek.seek();
    expect(seek).not.toHaveBeenCalled();
    expect(goalSeek.message()).toMatch(/value/i);
    goalSeek.setGoal('10');
    goalSeek.setSetCell('not a cell');
    await goalSeek.seek();
    expect(goalSeek.message()).toMatch(/B12/);
  });
});
