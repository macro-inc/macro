import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { DriveFolderMetadata } from '../context/drive-source';
import { createOptimisticFoldersController } from './drive-optimistic-folders';

const folder = (
  id: string,
  name: string,
  parentId: string | null = null
): DriveFolderMetadata => ({
  id,
  name,
  parentId,
  userId: 'user-1',
});

describe('createOptimisticFoldersController', () => {
  it('applies optimistic creates, moves, renames, and trashes immediately and reconciles on server update', () => {
    createRoot((dispose) => {
      const [server, setServer] = createSignal<DriveFolderMetadata[]>([
        folder('f1', 'Product'),
        folder('f2', 'Archive'),
      ]);
      const controller = createOptimisticFoldersController(server);

      controller.beginCreate(folder('temp-1', 'New Sub', 'f1'));
      expect(controller.folders().map((f) => f.id)).toEqual([
        'f1',
        'f2',
        'temp-1',
      ]);

      controller.confirmCreate('temp-1', 'f3');
      expect(controller.folders().map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);

      controller.beginMove(['f2'], 'f1');
      expect(controller.folders().find((f) => f.id === 'f2')?.parentId).toBe(
        'f1'
      );

      controller.beginRename('f1', 'Product Eng');
      expect(controller.folders().find((f) => f.id === 'f1')?.name).toBe(
        'Product Eng'
      );

      controller.beginTrash(['f2']);
      expect(controller.folders().map((f) => f.id)).toEqual(['f1', 'f3']);

      // Server catches up with f3 created, f1 renamed, f2 deleted.
      setServer([folder('f1', 'Product Eng'), folder('f3', 'New Sub', 'f1')]);
      expect(controller.folders().map((f) => f.id)).toEqual(['f1', 'f3']);

      // Rollback works cleanly on failure.
      controller.beginMove(['f3'], null);
      expect(controller.folders().find((f) => f.id === 'f3')?.parentId).toBe(
        null
      );
      controller.rollbackMove(['f3']);
      expect(controller.folders().find((f) => f.id === 'f3')?.parentId).toBe(
        'f1'
      );

      dispose();
    });
  });
});
