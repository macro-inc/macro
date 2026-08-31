import { createListController } from '@app/components/list/create-list-controller';
import type { EntityData } from '@entity';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { toEntityActionListState } from './to-entity-action-list-state';

type Row =
  | { kind: 'entity'; id: string; entity: EntityData }
  | { kind: 'header'; id: string };

const entity = (id: string): EntityData => ({
  id,
  type: 'document',
  name: id,
  ownerId: 'owner',
});

const withRoot = (run: () => void) =>
  createRoot((dispose) => {
    try {
      run();
    } finally {
      dispose();
    }
  });

describe('toEntityActionListState', () => {
  it('projects entity rows and maps focus and selection to the controller', () => {
    withRoot(() => {
      const first = entity('first');
      const second = entity('second');
      const rows: Row[] = [
        { kind: 'entity', id: 'first-occurrence', entity: first },
        { kind: 'header', id: 'header' },
        { kind: 'entity', id: 'second-occurrence', entity: second },
      ];
      const controller = createListController({
        items: () => rows,
        getKey: (row) => row.id,
        selection: {
          getKey: (row) => (row.kind === 'entity' ? row.entity.id : row.id),
        },
        isNavigable: (row) => row.kind === 'entity',
        isSelectable: (row) => row.kind === 'entity',
      });
      const onFocus = vi.fn();
      const state = toEntityActionListState({
        controller,
        getEntity: (row) => (row.kind === 'entity' ? row.entity : undefined),
        onFocus,
      });

      controller.focus.set('first-occurrence');
      controller.selection.set('first-occurrence', true);

      expect(state.items.count()).toBe(2);
      expect(state.focus.id()).toBe('first-occurrence');
      expect(state.focus.index()).toBe(0);
      expect(state.items.get(second.id)?.id).toBe('second-occurrence');
      expect(state.navigate.peekOffset(1)?.row.id).toBe('second-occurrence');

      state.focus.set('second-occurrence');
      expect(controller.focus.key()).toBe('second-occurrence');
      expect(onFocus).toHaveBeenCalledWith({
        key: 'second-occurrence',
        index: 2,
        entity: second,
      });

      state.selection.clear();
      expect(controller.selection.count()).toBe(0);
      expect(controller.selection.anchor()).toBeUndefined();
    });
  });
});
