import type { EntityData } from '@entity';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

// The real module reaches the query clients, which open websockets under jsdom.
vi.mock('./make-mark-done-action', () => ({
  canExecuteMarkDoneOnView: () => true,
}));

import { toSingleEntityActionListState } from './entity-action-context';

const channel: EntityData = {
  id: 'channel',
  type: 'channel',
  name: 'Design',
  ownerId: 'owner',
  channelType: 'private',
};

describe('toSingleEntityActionListState', () => {
  it('holds the one entity and has nowhere to move on to', () => {
    createRoot((dispose) => {
      const list = toSingleEntityActionListState(() => channel);

      expect(list.items.count()).toBe(1);
      expect(list.items.at(0)?.original).toBe(channel);
      expect(list.items.get('channel')?.original).toBe(channel);

      list.focus.set('channel');
      expect(list.focus.index()).toBe(0);
      // Nothing to advance to: peeking either way stays on the entity.
      expect(list.navigate.peekOffset(1)?.index).toBe(0);
      expect(list.navigate.peekOffset(-1)?.index).toBe(0);

      dispose();
    });
  });

  it('is empty until the surface resolves its entity', () => {
    createRoot((dispose) => {
      const list = toSingleEntityActionListState(() => undefined);

      expect(list.items.count()).toBe(0);
      expect(list.navigate.peekOffset(1)).toBeUndefined();

      dispose();
    });
  });
});
