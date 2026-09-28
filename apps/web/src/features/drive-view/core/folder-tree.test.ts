import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  filterFolderTree,
  folderAncestors,
} from './folder-tree';

const folders = [
  { id: 'root', name: 'Design' },
  { id: 'child', name: 'Wireframes', parentId: 'root' },
  { id: 'nested', name: 'Drive', parentId: 'child' },
  { id: 'orphan', name: 'Assets', parentId: 'inaccessible' },
];

describe('Drive folder navigation', () => {
  it('builds nested folders and keeps folders whose parents are inaccessible', () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((node) => node.id)).toEqual(['orphan', 'root']);
    expect(tree[1].children[0].children[0].id).toBe('nested');
  });
  it('searches descendants without losing their ancestors', () => {
    const matches = filterFolderTree(buildFolderTree(folders), ' dRiVe ');
    expect(matches.map((node) => node.id)).toEqual(['root']);
    expect(matches[0].children[0].children[0].id).toBe('nested');
    expect(filterFolderTree(buildFolderTree(folders), 'absent')).toEqual([]);
  });
  it('orders breadcrumb ancestors and tolerates broken/cyclic hierarchies', () => {
    expect(
      folderAncestors(folders, 'nested').map((folder) => folder.id)
    ).toEqual(['root', 'child', 'nested']);
    const cyclic = [
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ];
    expect(buildFolderTree(cyclic)).toHaveLength(2);
    expect(folderAncestors(cyclic, 'a')).toHaveLength(2);
    expect(folderAncestors(folders, 'missing')).toEqual([]);
  });
});
