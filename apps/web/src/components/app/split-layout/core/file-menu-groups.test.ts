import type { MenuGroup } from '@core/menu/group-menu-items';
import { describe, expect, it } from 'vitest';
import { fileMenuGroups } from './file-menu-groups';

type Action = { id: string; group: MenuGroup; label?: string };
describe('fileMenuGroups', () => {
  it('orders contributions, copies, and mutations without dropping actions', () => {
    const tools: Action[] = [
      { id: 'download', group: 'share-export' },
      { id: 'history', group: 'info' },
      { id: 'share', group: 'most-used' },
      { id: 'format-copy', group: 'copy' },
    ];
    const operations: Action[] = [
      { id: 'delete', group: 'delete' },
      { id: 'duplicate', group: 'modify' },
      { id: 'add-tag', group: 'modify' },
      { id: 'rename', group: 'modify' },
      { id: 'copy-id', group: 'copy' },
      { id: 'appearance', group: 'modify' },
      { id: 'copy-link', group: 'copy' },
      { id: 'move-to-folder', group: 'modify' },
      { id: 'mute', group: 'state' },
    ];
    const groups = fileMenuGroups(tools, operations);
    expect(groups.copy.map((action) => action.id)).toEqual([
      'copy-link',
      'copy-id',
      'format-copy',
    ]);
    expect(groups.modify.map((action) => action.id)).toEqual([
      'rename',
      'appearance',
      'duplicate',
      'move-to-folder',
      'add-tag',
    ]);
    expect(Object.values(groups).flat()).toHaveLength(
      tools.length + operations.length
    );
    expect(groups.delete).toEqual([operations[0]]);
    expect(groups['share-export'][0]).toBe(tools[0]);
    expect(operations[0].id).toBe('delete');
  });

  it('sorts by semantic keys without merging distinct contribution identities', () => {
    const actions = [
      { id: 'operation-0', orderKey: 'duplicate', group: 'modify' as const },
      { id: 'operation-1', orderKey: 'rename', group: 'modify' as const },
      { id: 'operation-2', orderKey: 'rename', group: 'modify' as const },
    ];
    expect(fileMenuGroups([], actions).modify).toEqual([
      actions[1],
      actions[2],
      actions[0],
    ]);
  });

  it('does not restore an unavailable action or snapshot a getter', () => {
    let label = 'Favorite';
    const favorite = {
      id: 'favorite',
      group: 'most-used' as const,
      get label() {
        return label;
      },
    };
    const groups = fileMenuGroups([favorite], []);
    expect(groups.modify).toEqual([]);
    expect(groups.delete).toEqual([]);
    expect(groups['most-used'][0]).toBe(favorite);
    label = 'Unfavorite';
    expect(groups['most-used'][0].label).toBe('Unfavorite');
  });
});
