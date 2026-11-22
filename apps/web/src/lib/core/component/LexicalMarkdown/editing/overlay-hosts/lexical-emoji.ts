import { InlineSearchNode } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import {
  CLOSE_EMOJI_SEARCH_COMMAND,
  INSERT_TEXT_COMMAND,
  REMOVE_EMOJI_SEARCH_COMMAND,
} from '../../plugins';
import type { EmojiMenuHost } from './emoji';

/** Preserve Source command order, immediate root callback and transform lifetime. */
export function createLexicalEmojiMenuHost(
  editor: Accessor<LexicalEditor>
): EmojiMenuHost {
  return {
    root: () => editor().getRootElement(),
    subscribeRoot: (listener) => editor().registerRootListener(listener),
    insertEmoji(text) {
      editor().dispatchCommand(REMOVE_EMOJI_SEARCH_COMMAND, undefined);
      editor().dispatchCommand(INSERT_TEXT_COMMAND, text);
    },
    closeSearch() {
      editor().dispatchCommand(CLOSE_EMOJI_SEARCH_COMMAND, undefined);
    },
    registerSearchText(listener) {
      // The Source component did not release this transform on unmount. Retain
      // its editor lifetime rather than inventing a menu-owned cleanup.
      editor().registerNodeTransform(InlineSearchNode, (node) => {
        listener(node.getTextContent());
      });
    },
  };
}
