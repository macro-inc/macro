import { createMemo, createSignal } from 'solid-js';
import type {
  FeedPreferences,
  FeedSource,
} from '../../for-you/context/feed-source';
import { createFeedItems } from '../../for-you/primitives/feed';

/** A compact view of the same recommendations and dismissals as For you. */
export function createFocusActions(
  source: FeedSource,
  preferences: FeedPreferences
) {
  const feed = createFeedItems(source, preferences);
  const actions = createMemo(() => feed.visible().slice(0, 5));
  const [selection, setSelectedId] = createSignal<string>();
  const selectedId = createMemo(
    () =>
      actions().find((item) => item.id === selection())?.id ?? actions()[0]?.id
  );
  const [notice, setNotice] = createSignal('');
  return {
    actions,
    selectedId,
    setSelectedId,
    notice,
    canUndo: feed.canUndo,
    move: (direction: number) => {
      const list = actions();
      const index = list.findIndex((item) => item.id === selectedId());
      const next =
        list[Math.max(0, Math.min(list.length - 1, index + direction))];
      setSelectedId(next?.id);
      return next?.id;
    },
    dismiss: (id: string) => {
      const list = actions();
      const index = list.findIndex((item) => item.id === id);
      if (index < 0) return;
      feed.dismiss(id);
      setSelectedId(list[index + 1]?.id ?? list[index - 1]?.id);
      setNotice('Set aside for now');
    },
    undo: () => {
      setSelectedId(feed.undo());
      setNotice('Brought back to your list');
    },
  };
}
