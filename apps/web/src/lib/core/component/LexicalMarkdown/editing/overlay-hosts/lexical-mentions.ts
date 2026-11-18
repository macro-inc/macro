import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import { createItemHandler } from '../../component/menu/MentionsMenu/utils/mentionHandlers';
import { CLOSE_INLINE_SEARCH_COMMAND } from '../../plugins';
import type { HandlerDependencies } from '../../utils/mentionsUtils';
import type { MentionMenuHost } from './mentions';

/** Capture Source insertion dependencies while retaining dynamic root/close reads. */
export function createLexicalMentionMenuHost(
  editor: Accessor<LexicalEditor | undefined>,
  dependencies: HandlerDependencies | undefined
): MentionMenuHost {
  const select = dependencies ? createItemHandler(dependencies) : undefined;
  return {
    root: () => editor()?.getRootElement() ?? null,
    closeSearch() {
      editor()?.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    },
    select: (item) => select?.(item),
  };
}
