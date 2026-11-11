import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { createViewCommand } from '@macro-inc/lexical-wasm-view/view/commands';
import {
  dispatchApplicationCommand,
  queryApplication,
} from '../../plugins/group-b/command';
import type { MenuOperations } from '../../shared/inlineMenu';
import { createInlineMenuTriggerListener } from '../../shared/registerInlineMenuTrigger';
import { createNativeListenerScope } from './native-listeners';

const enter = createViewCommand(
  'Key(Enter)',
  (value): value is KeyboardEvent | null =>
    value === null || value instanceof KeyboardEvent
);
function searchRecord(value: unknown) {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('kind' in value) ||
    typeof value.kind !== 'string' ||
    !['actions', 'mentions', 'emojis', 'snippets'].includes(value.kind) ||
    !('open' in value) ||
    typeof value.open !== 'boolean' ||
    !('term' in value) ||
    typeof value.term !== 'string'
  ) {
    throw new Error('Invalid native inline-search controller snapshot');
  }
  return {
    kind: value.kind,
    open: value.open,
    term: value.term,
    callback: 'callback' in value ? value.callback : undefined,
  };
}

/** Model callbacks update UI state; local menu resets never write model intent. */
export function registerNativeMentionSearch(
  view: EditorView,
  menu: MenuOperations
): () => void {
  if (!view.port.nativeEnter)
    throw new Error('Native mentions require the ordered Enter capability');
  const listeners = createNativeListenerScope();
  try {
    listeners.add(
      view.onPluginEvent('group-a.search-change', (payload) => {
        const event = searchRecord(payload);
        if (event.kind !== 'mentions') return;
        if (event.callback === undefined)
          throw new Error('Missing native inline-search callback');
        switch (event.callback) {
          case 'open':
            menu.openMenu();
            break;
          case 'close':
            menu.closeMenu();
            break;
          case 'term':
            menu.setSearchTerm(event.term);
            break;
          default:
            throw new Error('Unknown native inline-search callback');
        }
      })
    );
    const initial = searchRecord(
      queryApplication(view, 'group-a.search-query', { kind: 'mentions' })
    );
    if (initial.kind !== 'mentions')
      throw new Error('Native mention query returned a different controller');
    menu.setSearchTerm(initial.term);
    menu.setIsOpen(initial.open);
    // This issued native callback reads only the existing UI cache.
    listeners.add(view.registerViewCommand(enter, () => menu.isOpen(), 4));
    const rootListener = createInlineMenuTriggerListener('@', () => {
      dispatchApplicationCommand(view, 'group-a.search-trigger', {
        kind: 'mentions',
      });
    });
    // Own removal before attachment so a partially attached root unwinds too.
    listeners.add(() => rootListener(null, view.root));
    rootListener(view.root, null);
    return listeners.dispose;
  } catch (error) {
    return listeners.fail(error);
  }
}
