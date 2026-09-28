import { describe, expect, it } from 'vitest';
import { cellBorderColor, cellForeground } from './cell-colors';

describe('workbook display colors', () => {
  it('uses themed ink for automatic or Excel black text on unfilled cells', () => {
    expect(cellForeground()).toBeUndefined();
    expect(cellForeground('#000000')).toBe('var(--color-ink)');
    expect(cellForeground('#000000', '')).toBe('var(--color-ink)');
    expect(cellBorderColor('#000000')).toBe('var(--color-ink)');
  });

  it('preserves intentional text, fill and border colors', () => {
    expect(cellForeground('#000000', '#fff2cc')).toBe('#000000');
    expect(cellForeground('#ffffff', '#123456')).toBe('#ffffff');
    expect(cellForeground('#FF0000')).toBe('#FF0000');
    expect(cellBorderColor('#123456')).toBe('#123456');
    expect(cellBorderColor('#000000', '#ffffff')).toBe('#000000');
  });

  it('chooses readable automatic text on literal fills in either theme', () => {
    expect(cellForeground('', '#fff2cc')).toBe('#000000');
    expect(cellForeground(undefined, '#ffffff')).toBe('#000000');
    expect(cellForeground(undefined, '#000000')).toBe('#ffffff');
    expect(cellForeground(undefined, '#123456')).toBe('#ffffff');
    expect(cellBorderColor(undefined, '#fff2cc')).toBe('#000000');
    expect(cellBorderColor(undefined, '#123456')).toBe('#ffffff');
  });
});
