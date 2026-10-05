import { describe, expect, it } from 'vitest';
import { cellBackground, cellBorderColor, cellForeground } from './cell-colors';

describe('workbook display colors', () => {
  it('uses themed ink for automatic or Excel black text on unfilled cells', () => {
    expect(cellForeground()).toBeUndefined();
    expect(cellForeground('#000000')).toBe('var(--color-ink)');
    expect(cellForeground('#000000', '')).toBe('var(--color-ink)');
    expect(cellBorderColor('#000000')).toBe('var(--color-ink)');
  });

  it('keeps dark template grays at their strength against the app background', () => {
    expect(cellForeground('#595959')).toBe(
      'color-mix(in srgb, var(--color-ink) 65%, transparent)'
    );
    expect(cellForeground('#404040', '')).toBe(
      'color-mix(in srgb, var(--color-ink) 75%, transparent)'
    );
    expect(cellForeground('#3B3838')).toBe(
      'color-mix(in srgb, var(--color-ink) 78%, transparent)'
    );
    expect(cellBorderColor('#7f7f7f')).toBe(
      'color-mix(in srgb, var(--color-ink) 50%, transparent)'
    );
    // Lighter grays, colors and filled cells keep their literal values.
    expect(cellForeground('#a6a6a6')).toBe('#a6a6a6');
    expect(cellForeground('#1f3864')).toBe('#1f3864');
    expect(cellForeground('#595959', '#fff2cc')).toBe('#595959');
  });

  it('preserves intentional text, fill and border colors', () => {
    expect(cellForeground('#000000', '#fff2cc')).toBe('#000000');
    expect(cellForeground('#ffffff', '#123456')).toBe('#ffffff');
    expect(cellForeground('#FF0000')).toBe('#FF0000');
    expect(cellBorderColor('#123456')).toBe('#123456');
    expect(cellBorderColor('#000000', '#fff2cc')).toBe('#000000');
  });

  it('treats white fills as paper that follows the app background', () => {
    expect(cellBackground('#FFFFFF')).toBe('var(--color-surface)');
    expect(cellBackground('#fff2cc')).toBe('#fff2cc');
    expect(cellBackground()).toBeUndefined();
    expect(cellForeground(undefined, '#ffffff')).toBeUndefined();
    expect(cellForeground('#000000', '#FFFFFF')).toBe('var(--color-ink)');
    expect(cellForeground('#1f3864', '#ffffff')).toBe('#1f3864');
    expect(cellBorderColor('#000000', '#ffffff')).toBe('var(--color-ink)');
  });

  it('chooses readable automatic text on literal fills in either theme', () => {
    expect(cellForeground('', '#fff2cc')).toBe('#000000');
    expect(cellForeground(undefined, '#f2f2f2')).toBe('#000000');
    expect(cellForeground(undefined, '#000000')).toBe('#ffffff');
    expect(cellForeground(undefined, '#123456')).toBe('#ffffff');
    expect(cellBorderColor(undefined, '#fff2cc')).toBe('#000000');
    expect(cellBorderColor(undefined, '#123456')).toBe('#ffffff');
  });
});
