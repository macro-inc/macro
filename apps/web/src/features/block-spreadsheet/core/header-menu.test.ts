import { describe, expect, it } from 'vitest';
import { headerMenuEntries } from './header-menu';

describe('spreadsheet header menu', () => {
  it('orders row actions with deletion last', () => {
    expect(headerMenuEntries('row')).toEqual([
      'copy',
      'separator',
      'cut',
      'paste',
      'paste-values',
      'separator',
      'insert-before',
      'insert-after',
      'clear-values',
      'resize',
      'autofit',
      'separator',
      'hide',
      'unhide',
      'separator',
      'delete',
    ]);
  });

  it('offers sorting for columns only, before state and deletion', () => {
    expect(headerMenuEntries('column')).toEqual([
      'copy',
      'separator',
      'cut',
      'paste',
      'paste-values',
      'separator',
      'insert-before',
      'insert-after',
      'clear-values',
      'resize',
      'autofit',
      'separator',
      'sort-asc',
      'sort-desc',
      'separator',
      'hide',
      'unhide',
      'separator',
      'delete',
    ]);
    expect(headerMenuEntries('row')).not.toContain('sort-asc');
  });
});
