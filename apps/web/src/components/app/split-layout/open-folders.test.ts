import { driveFolderContent } from '@app/features/drive-view/drive-hosted-content';
import { describe, expect, it, vi } from 'vitest';
import type { SplitContent, SplitManager } from './layoutManager';
import { openFolder, openFolderIds } from './open-folders';

const folderBlock = (id: string): SplitContent => ({ type: 'project', id });

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
