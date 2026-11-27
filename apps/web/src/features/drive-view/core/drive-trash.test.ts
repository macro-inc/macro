import { describe, expect, it } from 'vitest';
import {
  type DriveTrashItem,
  filterTrashItems,
  summarizeTrashHierarchy,
} from './drive-trash';

describe('drive-trash', () => {
  const items: DriveTrashItem[] = [
    {
      id: 'folder-1',
      itemType: 'project',
      name: 'Old Archive',
      deletedAt: '2026-05-14T10:00:00Z',
      updatedAt: '2026-05-14T10:00:00Z',
      parentFolderId: null,
      ownerId: 'u1',
    },
    {
      id: 'doc-nested',
      itemType: 'document',
      name: 'Nested Spec.md',
      fileType: 'md',
      deletedAt: '2026-05-14T10:00:00Z',
      updatedAt: '2026-05-14T10:00:00Z',
      parentFolderId: 'folder-1',
      ownerId: 'u1',
    },
    {
      id: 'doc-standalone',
      itemType: 'document',
      name: 'Budget 2026.pdf',
      fileType: 'pdf',
      deletedAt: '2026-05-15T09:00:00Z',
      updatedAt: '2026-05-15T09:00:00Z',
      parentFolderId: 'live-folder',
      ownerId: 'u1',
    },
  ];

  it('filters trashed items by name and file type', () => {
    expect(filterTrashItems(items, '')).toHaveLength(3);
    expect(filterTrashItems(items, 'budget').map((i) => i.id)).toEqual([
      'doc-standalone',
    ]);
    expect(filterTrashItems(items, 'PDF').map((i) => i.id)).toEqual([
      'doc-standalone',
    ]);
  });

  it('deduplicates items nested under a trashed parent folder and counts them', () => {
    const summary = summarizeTrashHierarchy(items);
    expect(summary.topLevel.map((i) => i.id)).toEqual([
      'folder-1',
      'doc-standalone',
    ]);
    expect(summary.nestedCountByFolderId.get('folder-1')).toBe(1);
  });
});
