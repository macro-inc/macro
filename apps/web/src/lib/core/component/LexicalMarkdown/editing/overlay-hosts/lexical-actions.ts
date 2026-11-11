import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import {
  CLOSE_ACTION_SEARCH_COMMAND,
  REMOVE_ACTION_SEARCH_COMMAND,
} from '../../plugins/actions/actionsPlugin';
import type { ActionMenuHost } from './actions';

/** Keep Source removal, dependency checks and action dispatch in their order. */
export function createLexicalActionMenuHost(
  editor: Accessor<LexicalEditor>
): ActionMenuHost {
  return {
    root: () => editor().getRootElement(),
    subscribeRoot: (listener) => editor().registerRootListener(listener),
    hasDependencies: (dependencies) => editor().hasNodes(dependencies),
    closeSearch() {
      editor().dispatchCommand(CLOSE_ACTION_SEARCH_COMMAND, undefined);
    },
    select(item, origin, context) {
      editor().dispatchCommand(REMOVE_ACTION_SEARCH_COMMAND, undefined);
      if (!item) return;
      if (origin === 'keyboard') {
        item.action(editor(), context);
        return;
      }
      const { action, dependencies } = item;
      if (action) {
        if (dependencies !== undefined) {
          if (editor().hasNodes(dependencies)) {
            action(editor(), context);
          } else {
            console.error('Dispatched Action with missing dependencies:', item);
          }
        } else {
          action(editor(), context);
        }
      }
    },
  };
}
