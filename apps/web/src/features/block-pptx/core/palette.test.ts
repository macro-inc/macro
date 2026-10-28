import { describe, expect, it } from 'vitest';
import { modulate, themeGrid } from './palette';

describe('palette', () => {
  it('modulates luminance like PowerPoint', () => {
    expect(modulate('4472C4', 0.75)).toBe('2F5597');
    expect(modulate('FFFFFF', 0.95)).toBe('F2F2F2');
    expect(modulate('000000', 1, 0.5)).toBe('808080');
  });

  it('builds ten columns of six swatches', () => {
    const grid = themeGrid([
      ['dk1', '#000000'],
      ['lt1', '#FFFFFF'],
      ['dk2', '#44546A'],
      ['lt2', '#E7E6E6'],
      ['accent1', '#4472C4'],
      ['accent2', '#ED7D31'],
      ['accent3', '#A5A5A5'],
      ['accent4', '#FFC000'],
      ['accent5', '#5B9BD5'],
      ['accent6', '#70AD47'],
    ]);
    expect(grid).toHaveLength(10);
    expect(grid.every((column) => column.length === 6)).toBe(true);
    expect(grid[0][0].value).toBe('bg1');
    expect(grid[4][4].label).toBe('Accent 1, Darker 25%');
  });
});
