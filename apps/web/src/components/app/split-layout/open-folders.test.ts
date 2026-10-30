import { driveFolderContent } from '@app/features/drive-view/drive-hosted-content';
import { paneRoute } from '@app/routes/app-route';
import { describe, expect, it, vi } from 'vitest';
import type { SplitContent, SplitManager } from './layoutManager';
import { openFolder, openFolderIds } from './open-folders';

const folderBlock = (id: string): SplitContent => ({ type: 'project', id });
const documentInFolder = (folderId: string): SplitContent => ({
  type: 'component',
  id: 'documents',
  entryMetadata: {
    route: paneRoute(
      { id: 'drive', params: {} },
      { id: 'drive-folder', params: { view: 'folder', folderId } },
      {
        id: 'drive-folder-document',
        params: { documentId: 'doc', documentType: 'md' },
      }
    ),
  },
});

const managerWith = (...contents: SplitContent[]) =>
  ({
    splits: () =>
      contents.map((content, index) => ({ id: `split-${index}`, content })),
    activateSplit: vi.fn(),
    openWithSplit: vi.fn(),
  }) as unknown as SplitManager;

describe('openFolder', () => {
  it.each([true, false])(
    'opens the folder in Drive (new split: %s)',
    (newSplit) => {
      const manager = managerWith(driveFolderContent('other'));
      openFolder(manager, 'folder', { newSplit });
      expect(manager.openWithSplit).toHaveBeenCalledWith(
        driveFolderContent('folder'),
        { preferNewSplit: newSplit, allowDuplicate: true }
      );
      expect(manager.activateSplit).not.toHaveBeenCalled();
    }
  );

  it('lists the folder rather than focusing an item open inside it', () => {
    const manager = managerWith(documentInFolder('folder'));
    expect(openFolderIds(manager)).toEqual(['folder']);

    openFolder(manager, 'folder', { newSplit: false });

    expect(manager.activateSplit).not.toHaveBeenCalled();
    expect(manager.openWithSplit).toHaveBeenCalledWith(
      driveFolderContent('folder'),
      { preferNewSplit: false, allowDuplicate: true }
    );
  });

  it.each([
    ['its own block', folderBlock('folder')],
    ['Drive', driveFolderContent('folder')],
  ])('focuses a split showing the folder in %s', (_, content) => {
    const manager = managerWith({ type: 'md', id: 'doc' }, content);
    expect(openFolderIds(manager)).toEqual(['folder']);

    for (const newSplit of [false, true]) {
      openFolder(manager, 'folder', { newSplit });
    }

    expect(manager.activateSplit).toHaveBeenCalledTimes(2);
    expect(manager.activateSplit).toHaveBeenCalledWith('split-1');
    expect(manager.openWithSplit).not.toHaveBeenCalled();
  });
});
