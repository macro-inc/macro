import { createMemo } from 'solid-js';
import type { BoardCapabilities } from '../context/board-context';
import type { BoardItem } from '../core/item';
import {
  type BoardFreshness,
  isOnBoard,
  itemFreshness,
} from '../core/lifecycle';
import type { BoardMemory } from './board-memory';

export type BoardSceneView =
  | { t: 'loading' }
  | { t: 'error' }
  | { t: 'empty'; hidden: number }
  | { t: 'ready' };

/**
 * The items on the board right now: the source's items, minus what the
 * viewer closed and what has gone quiet, each with its freshness.
 */
export function createBoardScene(
  board: Pick<BoardCapabilities, 'source' | 'now'>,
  memory: BoardMemory
) {
  const entries = createMemo(() => {
    const now = board.now();
    return board.source.items().map((item) => ({
      item,
      freshness: itemFreshness(item, memory.recall(item.key), now),
    }));
  });

  const freshnessByKey = createMemo(
    () =>
      new Map<string, BoardFreshness>(
        entries().map((entry) => [entry.item.key, entry.freshness])
      )
  );

  const items = createMemo((): BoardItem[] =>
    entries()
      .filter((entry) => isOnBoard(entry.freshness, memory.showSettled()))
      .map((entry) => entry.item)
  );

  const hiddenCount = () =>
    memory.showSettled()
      ? 0
      : entries().filter((entry) => entry.freshness === 'expired').length;

  const view = (): BoardSceneView => {
    const state = board.source.state();
    if (items().length > 0) return { t: 'ready' };
    if (state === 'loading') return { t: 'loading' };
    if (state === 'error') return { t: 'error' };
    return { t: 'empty', hidden: hiddenCount() };
  };

  return {
    items,
    view,
    hiddenCount,
    freshness: (key: string): BoardFreshness =>
      freshnessByKey().get(key) ?? 'fresh',
    unreadCount: () =>
      items().reduce((total, item) => total + item.unreadCount, 0),
    item: (key: string) =>
      entries().find((entry) => entry.item.key === key)?.item,
  };
}

export type BoardScene = ReturnType<typeof createBoardScene>;
