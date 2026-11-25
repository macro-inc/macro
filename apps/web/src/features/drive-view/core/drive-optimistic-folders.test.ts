import { describe, expect, it } from 'vitest';
import {
  applyOptimisticFolders,
  EMPTY_OPTIMISTIC_FOLDER_OVERLAY,
  type OptimisticFolderOverlay,
  type OptimisticFolderRecord,
  reconcileOptimisticFolders,
} from './drive-optimistic-folders';

type TestFolder = OptimisticFolderRecord & { userId: string };

const folder = (
  id: string,
  name: string,
  parentId: string | null = null
): TestFolder => ({
  id,
  name,
  parentId,
  userId: 'user-1',
});

describe('drive-optimistic-folders', () => {
  it('applies optimistic creates, moves, renames, and trashes without duplicates', () => {
    const server = [folder('f1', 'Product'), folder('f2', 'Archive')];
    const overlay: OptimisticFolderOverlay<TestFolder> = {
      created: new Map([
        ['temp-1', folder('temp-1', 'New Sub', 'f1')],
        ['f1', folder('f1', 'Duplicate')],
      ]),
      moved: new Map([['f2', 'f1']]),
      renamed: new Map([['f1', 'Product Roadmap']]),
      trashed: new Set(),
    };

    const result = applyOptimisticFolders(server, overlay);
    expect(result).toEqual([
      folder('f1', 'Product Roadmap', null),
      folder('f2', 'Archive', 'f1'),
      folder('temp-1', 'New Sub', 'f1'),
    ]);
  });

  it('hides optimistically trashed folders and clears settled overrides on reconcile', () => {
    const server = [folder('f1', 'Product'), folder('f2', 'Trash Me')];
    const overlay: OptimisticFolderOverlay<TestFolder> = {
      created: new Map([['f3', folder('f3', 'Specs', 'f1')]]),
      moved: new Map([['f1', null]]),
      renamed: new Map([['f1', 'Product']]),
      trashed: new Set(['f2']),
    };

    expect(
      applyOptimisticFolders(server, overlay).map((item) => item.id)
    ).toEqual(['f1', 'f3']);

    // Server now contains f3, reflects f1 move/rename, and removed f2.
    const nextServer = [
      folder('f1', 'Product', null),
      folder('f3', 'Specs', 'f1'),
    ];
    const reconciled = reconcileOptimisticFolders(nextServer, overlay);
    expect(reconciled).toEqual(EMPTY_OPTIMISTIC_FOLDER_OVERLAY);
  });
});
