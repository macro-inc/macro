import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import {
  CLOSE_INLINE_SEARCH_COMMAND,
  REMOVE_INLINE_SEARCH_COMMAND,
} from '../../plugins/mentions/mentionsPlugin';
import { INSERT_TAG_MENTION_COMMAND } from '../../plugins/tags';
import type { TagsMenuHost } from './tags';

/** Preserve the Source command order of the Lexical tags menu. */
export function createLexicalTagsMenuHost(
  editor: Accessor<LexicalEditor>
): TagsMenuHost {
  return {
    root: () => editor().getRootElement(),
    closeSearch() {
      editor().dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    },
    insertTag(tag) {
      editor().dispatchCommand(REMOVE_INLINE_SEARCH_COMMAND, undefined);
      editor().dispatchCommand(INSERT_TAG_MENTION_COMMAND, tag);
    },
  };
}
