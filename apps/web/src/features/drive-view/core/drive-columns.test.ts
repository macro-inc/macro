import { describe, expect, it } from 'vitest';
import { buildMillerColumnPath, collapseBreadcrumbs } from './drive-columns';

describe('drive-columns', () => {
  const folders = [
    { id: 'a', name: 'Workspace' },
    { id: 'b', name: 'Product', parentId: 'a' },
    { id: 'c', name: 'Specs', parentId: 'b' },
  ];

  it('builds Miller column paths from My Drive root through active folder', () => {
    expect(buildMillerColumnPath(folders, null)).toEqual([null]);
    expect(buildMillerColumnPath(folders, 'a')).toEqual([null, 'a']);
    expect(buildMillerColumnPath(folders, 'c')).toEqual([null, 'a', 'b', 'c']);
    expect(buildMillerColumnPath(folders, 'missing')).toEqual([null]);
  });

  it('collapses deep breadcrumbs while preserving root and trailing segments', () => {
    expect(collapseBreadcrumbs(['Root', 'A', 'B'], 4)).toEqual({
      leading: ['Root', 'A', 'B'],
      hidden: [],
      trailing: [],
    });

    expect(collapseBreadcrumbs(['Root', 'A', 'B', 'C', 'D', 'E'], 4)).toEqual({
      leading: ['Root'],
      hidden: ['A', 'B'],
      trailing: ['C', 'D', 'E'],
    });
  });
});
