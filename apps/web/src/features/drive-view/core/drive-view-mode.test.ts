import { describe, expect, it } from 'vitest';
import {
  gridNextIndex,
  parseDriveRootBrowseMode,
  parseDriveViewMode,
} from './drive-view-mode';

describe('drive-view-mode', () => {
  it('parses view and root browse modes with safe fallbacks', () => {
    expect(parseDriveViewMode('list')).toBe('list');
    expect(parseDriveViewMode('grid')).toBe('grid');
    expect(parseDriveViewMode('columns')).toBe('columns');
    expect(parseDriveViewMode('unknown')).toBe('list');
    expect(parseDriveViewMode(null)).toBe('list');

    expect(parseDriveRootBrowseMode('browse')).toBe('browse');
    expect(parseDriveRootBrowseMode('all')).toBe('all');
    expect(parseDriveRootBrowseMode('other')).toBe('browse');
  });

  it('navigates 2D grid indices cleanly across full and ragged last rows', () => {
    // 10 items in 4 columns:
    // [0, 1, 2, 3]
    // [4, 5, 6, 7]
    // [8, 9]
    expect(gridNextIndex(0, 0, 4, 'right')).toBe(-1);
    expect(gridNextIndex(-1, 10, 4, 'right')).toBe(0);
    expect(gridNextIndex(-1, 10, 4, 'end')).toBe(9);
    expect(gridNextIndex(5, 10, 4, 'home')).toBe(0);
    expect(gridNextIndex(0, 10, 4, 'left')).toBe(0);
    expect(gridNextIndex(9, 10, 4, 'right')).toBe(9);
    expect(gridNextIndex(2, 10, 4, 'down')).toBe(6);
    // Row 1 col 3 -> ragged row 2 clamps to last item (9)
    expect(gridNextIndex(7, 10, 4, 'down')).toBe(9);
    // Already on last row -> stays put
    expect(gridNextIndex(8, 10, 4, 'down')).toBe(8);
    expect(gridNextIndex(9, 10, 4, 'up')).toBe(5);
    expect(gridNextIndex(1, 10, 4, 'up')).toBe(1);
  });
});
