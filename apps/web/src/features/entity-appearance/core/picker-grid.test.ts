import { describe, expect, it } from 'vitest';
import { nextPickerOption, type PickerOption, pickerRows } from './picker-grid';

const OPTIONS: PickerOption[] = Array.from({ length: 30 }, (_, index) => ({
  key: `work:${index}`,
  label: String(index),
  icon: { kind: 'macro', name: 'star' },
}));
const FILES: PickerOption[] = Array.from({ length: 12 }, (_, index) => ({
  key: `files:${index}`,
  label: String(index),
  icon: { kind: 'macro', name: 'file' },
}));

describe('virtual picker grid navigation', () => {
  it.each([8, 9])(
    'keeps columns across section boundaries in a %s-column grid',
    (columns) => {
      const rows = pickerRows(
        [
          { key: 'work', label: 'Work', options: OPTIONS },
          { key: 'files', label: 'Files', options: FILES },
        ],
        columns
      );
      const lastRowStart = Math.floor((OPTIONS.length - 1) / columns) * columns;
      const key = OPTIONS[lastRowStart + 1].key;
      expect(nextPickerOption(rows, key, 'ArrowDown')?.key).toBe('files:1');
      expect(nextPickerOption(rows, 'files:1', 'ArrowUp')?.key).toBe(key);
    }
  );

  it('navigates beyond the mounted viewport and skips headings', () => {
    const rows = pickerRows(
      [
        { key: 'work', label: 'Work', options: OPTIONS },
        { key: 'files', label: 'Files', options: FILES },
      ],
      9
    );
    expect(nextPickerOption(rows, undefined, 'ArrowUp')?.key).toBe('files:11');
    expect(nextPickerOption(rows, 'work:29', 'ArrowRight')?.key).toBe(
      'files:0'
    );
    expect(nextPickerOption(rows, 'files:0', 'ArrowLeft')?.key).toBe('work:29');
  });

  it('clamps columns in short rows and omits empty sections', () => {
    const rows = pickerRows(
      [
        { key: 'empty', label: 'Empty', options: [] },
        { key: 'work', label: 'Work', options: OPTIONS },
      ],
      9
    );
    expect(rows).toHaveLength(5);
    expect(nextPickerOption(rows, 'work:26', 'ArrowDown')?.key).toBe('work:29');
    expect(nextPickerOption([], undefined, 'ArrowDown')).toBeUndefined();
  });
});
