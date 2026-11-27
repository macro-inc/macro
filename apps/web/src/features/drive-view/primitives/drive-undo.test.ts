import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createDriveInlineEdit } from './drive-inline-edit';
import { createDriveUndoManager } from './drive-undo';

describe('drive-inline-edit', () => {
  it('ensures only one inline edit is active and guards commits while pending', async () => {
    await createRoot(async (dispose) => {
      const edit = createDriveInlineEdit();
      expect(edit.isEditing()).toBe(false);

      edit.startRename({
        id: 'd1',
        name: 'Doc.md',
        isFolder: false,
        surface: 'list',
      });
      expect(edit.renaming()?.id).toBe('d1');
      expect(edit.creatingFolder()).toBeUndefined();

      // Starting folder creation supersedes active rename
      edit.startCreateFolder({ parentId: null, surface: 'list' });
      expect(edit.renaming()).toBeUndefined();
      expect(edit.creatingFolder()?.surface).toBe('list');

      let resolveCommit!: (value: string) => void;
      const commitPromise = edit.runCommit(
        () =>
          new Promise<string>((resolve) => {
            resolveCommit = resolve;
          })
      );

      expect(edit.isPending()).toBe(true);
      // Ignores edits while commit is in flight
      edit.cancelAll();
      expect(edit.isPending()).toBe(true);
      resolveCommit('ok');
      const result = await commitPromise;
      expect(result).toBe('ok');
      expect(edit.isPending()).toBe(false);
      expect(edit.isEditing()).toBe(false);

      dispose();
    });
  });
});

describe('drive-undo manager', () => {
  it('executes undoById and undoLatest and restores failed actions to the stack', async () => {
    await createRoot(async (dispose) => {
      const undoMove = vi.fn().mockResolvedValue(true);
      const undoTrash = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      const undoRename = vi.fn().mockResolvedValue(true);

      const manager = createDriveUndoManager({
        undoMove,
        undoTrash,
        undoRename,
      });

      const moveId = manager.recordMove({
        items: [
          {
            entity: { id: 'd1', type: 'document', name: 'Plan.md' },
            previousProjectId: null,
          },
        ],
        destinationFolderId: 'f1',
        destinationName: 'Specs',
      });
      const trashId = manager.recordTrash([
        { id: 'd2', type: 'document', name: 'Draft.md' },
      ]);
      manager.recordRename({
        entity: { id: 'd3', type: 'document', name: 'Final.md' },
        previousName: 'WIP.md',
        nextName: 'Final.md',
      });

      expect(manager.size()).toBe(3);

      // Undo middle trash entry: fails first time -> restored onto stack
      const firstTrash = await manager.undoById(trashId);
      expect(firstTrash.status).toBe('failed');
      expect(manager.size()).toBe(3);

      // Retrying succeeds
      const secondTrash = await manager.undoById(trashId);
      expect(secondTrash.status).toBe('undone');
      expect(undoTrash).toHaveBeenCalledTimes(2);

      // Latest is rename
      const latest = await manager.undoLatest();
      expect(latest.status).toBe('undone');
      expect(undoRename).toHaveBeenCalledWith(
        { id: 'd3', type: 'document', name: 'Final.md' },
        'WIP.md'
      );

      // Undo remaining move by id
      const moveResult = await manager.undoById(moveId);
      expect(moveResult.status).toBe('undone');
      expect(undoMove).toHaveBeenCalledTimes(1);
      expect(manager.canUndo()).toBe(false);
      expect((await manager.undoLatest()).status).toBe('empty');

      dispose();
    });
  });
});
