import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { DriveState } from '../core/types';
import { createDriveNavigation } from './drive-navigation';

describe('Drive navigation state', () => {
  it('opens ancestors, clears refinements on navigation, and keeps search when filtering', () =>
    createRoot((dispose) => {
      const [state, setState] = createSignal<DriveState>({
        location: { kind: 'tab', tab: 'shared' },
        scope: 'attachments',
        sort: 'created_at',
        expandedFolderIds: ['unrelated'],
        favoritesOpen: false,
        rootOpen: false,
      });
      const apply = vi.fn();
      const onNavigate = vi.fn();
      const navigation = createDriveNavigation({
        state,
        setState,
        results: { apply },
        onNavigate,
        folders: () => [
          { id: 'parent', name: 'Parent' },
          { id: 'child', name: 'Child', parentId: 'parent' },
        ],
      });
      navigation.navigate({ kind: 'folder', id: 'child' });
      expect(state().expandedFolderIds).toEqual([
        'unrelated',
        'parent',
        'child',
      ]);
      expect(state()).toMatchObject({
        scope: 'default',
        rootOpen: true,
        favoritesOpen: false,
        sort: 'created_at',
      });
      expect(apply).toHaveBeenLastCalledWith(state(), true);
      expect(onNavigate).toHaveBeenCalledOnce();
      navigation.navigate({ kind: 'tab', tab: 'recent' });
      expect(state().location).toEqual({ kind: 'tab', tab: 'recent' });
      navigation.setScope('attachments');
      expect(apply).toHaveBeenLastCalledWith(state(), false);
      dispose();
    }));
});
