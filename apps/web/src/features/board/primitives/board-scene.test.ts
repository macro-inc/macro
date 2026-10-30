import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { BoardSourceState, BoardStorage } from '../context/board-context';
import type { BoardItem } from '../core/item';
import { boardItem, HOUR, NOW } from '../tests/items';
import { createBoardMemory } from './board-memory';
import { createBoardScene } from './board-scene';

/** A scene over a source the test drives, with empty memory. */
function withScene(
  run: (scene: {
    view: () => unknown;
    keys: () => string[];
    setItems: (items: BoardItem[]) => void;
    setState: (state: BoardSourceState) => void;
    setNow: (now: number) => void;
    memory: ReturnType<typeof createBoardMemory>;
  }) => void
) {
  createRoot((dispose) => {
    const [items, setItems] = createSignal<readonly BoardItem[]>([]);
    const [state, setState] = createSignal<BoardSourceState>('loading');
    const [now, setNow] = createSignal(NOW);
    let stored: unknown;
    const storage: BoardStorage = {
      read: () => stored,
      write: (value) => {
        stored = value;
      },
    };
    const memory = createBoardMemory(storage);
    const scene = createBoardScene(
      { source: { items, state, retry: () => {} }, now },
      memory
    );
    run({
      view: scene.view,
      keys: () => scene.items().map((item) => item.key),
      setItems,
      setState,
      setNow,
      memory,
    });
    dispose();
  });
}

describe('createBoardScene', () => {
  it('waits for the source, then reports failure only without rows', () => {
    withScene((scene) => {
      expect(scene.view()).toEqual({ t: 'loading' });
      scene.setState('error');
      expect(scene.view()).toEqual({ t: 'error' });
      // Rows already on the board stay through a failed refresh.
      scene.setItems([boardItem('launch', { unreadCount: 1 })]);
      expect(scene.view()).toEqual({ t: 'ready' });
    });
  });

  it('counts what went quiet as hidden until settled items are shown', () => {
    withScene((scene) => {
      scene.setState('ready');
      scene.setItems([boardItem('ideas', { lastActivityAt: NOW - 30 * HOUR })]);
      expect(scene.view()).toEqual({ t: 'empty', hidden: 1 });

      scene.memory.setShowSettled(true);
      expect(scene.keys()).toEqual(['ideas']);
    });
  });

  it('keeps a closed item away until something newer happens in it', () => {
    withScene((scene) => {
      scene.setState('ready');
      scene.setItems([boardItem('design', { lastActivityAt: NOW })]);
      scene.memory.dismiss('design', NOW);
      expect(scene.keys()).toEqual([]);

      scene.setItems([
        boardItem('design', { lastActivityAt: NOW + 1, unreadCount: 1 }),
      ]);
      scene.setNow(NOW + 1);
      expect(scene.keys()).toEqual(['design']);
    });
  });
});
