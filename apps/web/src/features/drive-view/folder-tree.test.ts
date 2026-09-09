import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import type { Project } from '@service-storage/generated/schemas/project';
import { describe, expect, it } from 'vitest';
import { buildFolderTree } from './folder-tree';

const folder = (id: string, parentId?: string): Project => ({
  id,
  name: id,
  parentId,
  type: 'project',
  userId: 'user',
});
describe('Drive folder hierarchy', () => {
  it('nests all descendants under their real parents and sorts siblings', () => {
    const tree = buildFolderTree([
      folder('z'),
      folder('child', 'a'),
      folder('a'),
      folder('grandchild', 'child'),
    ]);
    expect(tree.map((node) => node.folder.id)).toEqual(['a', 'z']);
    expect(tree[0].children[0].children[0].folder.id).toBe('grandchild');
  });
  it('keeps inaccessible-parent folders visible and excludes deleted folders', () => {
    expect(
      buildFolderTree([
        folder('orphan', 'missing'),
        { ...folder('deleted'), deletedAt: '2026-01-01' },
      ]).map((node) => node.folder.id)
    ).toEqual(['orphan']);
  });
  it('breaks cycles and deduplicates without dropping folders', () => {
    const tree = buildFolderTree([
      folder('a', 'b'),
      folder('b', 'a'),
      folder('c', 'c'),
      folder('a', 'b'),
    ]);
    expect(tree.map((node) => node.folder.id)).toEqual(['a', 'b', 'c']);
  });
});

it('Drive Recent uses last viewed ordering while retaining file-only scope', () => {
  const preset = getViewPreset('documents', 'recent', {
    userId: 'user',
    isTeamAdmin: false,
  });
  expect(preset?.sortMethod).toBe('viewed_at');
  expect(preset?.clientFilters.and).toEqual(['document-or-file']);
});
