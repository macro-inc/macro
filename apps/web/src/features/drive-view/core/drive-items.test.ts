import { describe, expect, it } from 'vitest';
import {
  countDirectSubfolders,
  directChildFolders,
  driveItemKind,
  filterRootBrowseItems,
  groupByTimeBucket,
  orderDriveDisplayItems,
  partitionFoldersAndFiles,
  renameSelectionRange,
  splitOwnedAndSharedFolders,
  topLevelFolders,
} from './drive-items';

describe('drive-items', () => {
  const folders = [
    { id: 'f1', name: 'Engineering', userId: 'u1' },
    { id: 'f2', name: 'Specs', parentId: 'f1', userId: 'u1' },
    { id: 'f3', name: 'Archive', parentId: 'f1', userId: 'u1' },
    { id: 'f4', name: 'RFCs', parentId: 'f2', userId: 'u1' },
    { id: 's1', name: 'Partner Docs', userId: 'u2' },
    { id: 's2', name: 'Q3', parentId: 's1', userId: 'u2' },
    {
      id: 's3',
      name: 'Shared Subfolder',
      parentId: 'hidden-parent',
      userId: 'u2',
    },
  ];

  it('counts direct accessible subfolders per parent', () => {
    const counts = countDirectSubfolders(folders);
    expect(counts.get('f1')).toBe(2);
    expect(counts.get('f2')).toBe(1);
    expect(counts.get('s1')).toBe(1);
    expect(counts.get('f4')).toBeUndefined();
    expect(counts.get('hidden-parent')).toBeUndefined();
  });

  it('splits owned and shared folders cleanly and finds top-level roots', () => {
    const { owned, shared } = splitOwnedAndSharedFolders(folders, 'u1');
    expect(owned.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(shared.map((f) => f.id)).toEqual(['s1', 's2', 's3']);

    // Shared subfolder with inaccessible parent stays reachable at top level
    expect(topLevelFolders(shared).map((f) => f.id)).toEqual(['s1', 's3']);
    expect(directChildFolders(owned, 'f1').map((f) => f.name)).toEqual([
      'Archive',
      'Specs',
    ]);
  });

  it('orders items with Folders First and explicit sort direction', () => {
    const items = [
      {
        id: 'd1',
        type: 'document',
        name: 'Notes 10.md',
        updatedAt: '2026-05-03T00:00:00Z',
      },
      {
        id: 'd2',
        type: 'document',
        name: 'Notes 2.md',
        updatedAt: '2026-05-01T00:00:00Z',
      },
      {
        id: 'p1',
        type: 'project',
        name: 'Zeta',
        updatedAt: '2026-05-02T00:00:00Z',
      },
      {
        id: 'p2',
        type: 'project',
        name: 'Alpha',
        updatedAt: '2026-05-04T00:00:00Z',
      },
    ];

    // Folders first + name asc (natural numeric sort)
    expect(
      orderDriveDisplayItems(items, {
        foldersFirst: true,
        sort: 'name',
        direction: 'asc',
      }).map((i) => i.id)
    ).toEqual(['p2', 'p1', 'd2', 'd1']);

    // Folders first + updated_at desc
    expect(
      orderDriveDisplayItems(items, {
        foldersFirst: true,
        sort: 'updated_at',
        direction: 'desc',
      }).map((i) => i.id)
    ).toEqual(['p2', 'p1', 'd1', 'd2']);

    // Mixed (foldersFirst = false) + updated_at desc
    expect(
      orderDriveDisplayItems(items, {
        foldersFirst: false,
        sort: 'updated_at',
        direction: 'desc',
      }).map((i) => i.id)
    ).toEqual(['p2', 'd1', 'p1', 'd2']);

    const partitioned = partitionFoldersAndFiles(items);
    expect(partitioned.folders.map((i) => i.id)).toEqual(['p1', 'p2']);
    expect(partitioned.files.map((i) => i.id)).toEqual(['d1', 'd2']);
  });

  it('filters root browse mode to top-level folders and unfiled files only when unfiltered', () => {
    const items = [
      { id: 'p1', type: 'project' },
      { id: 'd1', type: 'document' },
      { id: 'd2', type: 'document', projectId: 'p1' },
    ];

    expect(
      filterRootBrowseItems(items, 'browse', false).map((i) => i.id)
    ).toEqual(['p1', 'd1']);
    expect(filterRootBrowseItems(items, 'all', false).map((i) => i.id)).toEqual(
      ['p1', 'd1', 'd2']
    );
    expect(
      filterRootBrowseItems(items, 'browse', true).map((i) => i.id)
    ).toEqual(['p1', 'd1', 'd2']);
  });

  it('groups items into Today, Yesterday, This week, and Earlier relative to now', () => {
    const now = new Date('2026-05-15T14:00:00Z');
    const entries = [
      { id: 'today', ts: '2026-05-15T10:00:00Z' },
      { id: 'yesterday', ts: '2026-05-14T18:00:00Z' },
      { id: 'week', ts: '2026-05-10T12:00:00Z' },
      { id: 'old', ts: '2026-04-01T12:00:00Z' },
      { id: 'missing', ts: null },
    ];

    const grouped = groupByTimeBucket(entries, (e) => e.ts, now);
    expect(grouped).toEqual([
      { bucket: 'today', items: [entries[0]] },
      { bucket: 'yesterday', items: [entries[1]] },
      { bucket: 'this_week', items: [entries[2]] },
      { bucket: 'earlier', items: [entries[3], entries[4]] },
    ]);
  });

  it('classifies Drive item kinds and computes Finder-style rename selections', () => {
    expect(driveItemKind({ type: 'project' })).toBe('folder');
    expect(driveItemKind({ type: 'database' })).toBe('database');
    expect(driveItemKind({ type: 'form' })).toBe('form');
    expect(driveItemKind({ type: 'document', fileType: 'md' })).toBe(
      'markdown'
    );
    expect(driveItemKind({ type: 'document', fileType: 'pdf' })).toBe('pdf');
    expect(driveItemKind({ type: 'document', fileType: 'png' })).toBe('image');
    expect(driveItemKind({ type: 'document', fileType: 'xlsx' })).toBe(
      'spreadsheet'
    );
    expect(driveItemKind({ type: 'document', fileType: 'tsx' })).toBe('code');
    expect(
      driveItemKind({
        type: 'document',
        fileType: 'md',
        subType: { type: 'skill' },
      })
    ).toBe('skill');

    // File with extension -> selects stem only
    expect(renameSelectionRange('Q3 Roadmap.pdf', false)).toEqual({
      start: 0,
      end: 10,
    });
    expect(renameSelectionRange('archive.tar.gz', false)).toEqual({
      start: 0,
      end: 11,
    });
    // Folder with dot in name -> selects full name
    expect(renameSelectionRange('v2.1 Release', true)).toEqual({
      start: 0,
      end: 12,
    });
    // Dotfile -> selects full name
    expect(renameSelectionRange('.env', false)).toEqual({ start: 0, end: 4 });
    // Sentence with period and space -> selects full name
    expect(renameSelectionRange('Notes. Draft copy', false)).toEqual({
      start: 0,
      end: 17,
    });
  });
});
