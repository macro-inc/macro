import { fireAndForget } from '@core/util/fireAndForget';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  dispatchApplicationCommandIfSessionEdit,
  dispatchApplicationCommandSettled,
} from '../../plugins/group-b/command';
import type { EmojiMenuHost } from './emoji';

/** Native emoji commands; removal settles before the text insertion is issued. */
export function createNativeEmojiMenuHost(
  view: EditorView,
  alive: () => boolean
): EmojiMenuHost {
  const active = () => alive() && view.isMounted;
  const insert = async (text: string): Promise<void> => {
    const removal = await dispatchApplicationCommandSettled(
      view,
      'group-a.search-remove',
      {}
    );
    if (removal.status === 'error') throw removal.error;
    if (removal.status === 'cancelled' || !active()) return;
    const inserted = await dispatchApplicationCommandSettled(
      view,
      'group-b.insert-text',
      { text }
    );
    if (inserted.status === 'error') throw inserted.error;
  };
  return {
    root: () => (active() ? view.root : null),
    subscribeRoot(listener) {
      // Source registerRootListener reports the current root immediately; a
      // native view's root never changes.
      listener();
      return () => {};
    },
    insertEmoji(text) {
      if (!active()) return;
      fireAndForget(insert(text), 'native-emoji-menu');
    },
    closeSearch() {
      // Closing the UI writes only under current session edit access.
      if (active())
        dispatchApplicationCommandIfSessionEdit(
          view,
          'group-a.search-close',
          {}
        );
    },
    registerSearchText(listener) {
      // Source's InlineSearchNode transform: every created or changed search
      // reports its text, for the view's lifetime.
      view.onMutations('inline-search', (mutations) => {
        for (const [key, mutation] of mutations) {
          if (mutation === 'destroyed') continue;
          const node = view.mirror.node(key);
          if (node) listener(node.text);
        }
      });
    },
  };
}
