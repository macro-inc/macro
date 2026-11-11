import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../../plugins/group-b/command';
import type { MenuOperations } from '../../shared/inlineMenu';
import { registerNativeInlineSearch } from './native-inline-search';

/** Source tagsPlugin: a second '#' while the menu is open collapses the search. */
export function registerNativeTagsSearch(
  view: EditorView,
  menu: MenuOperations,
  onUnavailable?: (error: unknown) => void
): () => void {
  return registerNativeInlineSearch(
    view,
    menu,
    'tags',
    '#',
    onUnavailable,
    () => {
      if (!menu.isOpen()) return false;
      dispatchApplicationCommand(view, 'group-a.search-close', {});
      menu.closeMenu();
      return true;
    }
  );
}
