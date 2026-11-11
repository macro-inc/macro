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
  menu: MenuOperations,
  onUnavailable?: (error: unknown) => void
): () => void {
  if (!view.port.nativeEnter)
    throw new Error('Native mentions require the ordered Enter capability');
  const listeners = createNativeListenerScope();
  let disposed = false;
  let initialized = false;
  let releaseReady: (() => void) | undefined;
  const pending: ReturnType<typeof searchRecord>[] = [];
  const stopReady = () => {
    const release = releaseReady;
    releaseReady = undefined;
    release?.();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    pending.length = 0;
    listeners.dispose();
  };
  const unavailable = (error: unknown) => {
    if (disposed) return;
    disposed = true;
    pending.length = 0;
    if (!onUnavailable) listeners.fail(error);
    try {
      listeners.dispose();
    } catch (cleanupError) {
      onUnavailable?.(cleanupError);
    }
    menu.setIsOpen(false);
    onUnavailable?.(error);
  };
  const apply = (event: ReturnType<typeof searchRecord>) => {
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
  };
  const initialize = () => {
    if (initialized) return true;
    if (disposed || view.mirror.keyGeneration === null) return false;
    const initial = searchRecord(
      queryApplication(view, 'group-a.search-query', { kind: 'mentions' })
    );
    if (initial.kind !== 'mentions')
      throw new Error('Native mention query returned a different controller');
    // The real hosted view is installed before its first acknowledged projection.
    // A missing generation is readiness, never an invented controller snapshot.
    menu.setSearchTerm(initial.term);
    menu.setIsOpen(initial.open);
    // This issued native callback reads only the existing UI cache.
    listeners.add(view.registerViewCommand(enter, () => menu.isOpen(), 4));
    const rootListener = createInlineMenuTriggerListener('@', () => {
      dispatchApplicationCommand(view, 'group-a.search-trigger', {
        kind: 'mentions',
      });
    });
    listeners.add(() => rootListener(null, view.root));
    rootListener(view.root, null);
    initialized = true;
    stopReady();
    for (const event of pending.splice(0)) apply(event);
    return true;
  };
  try {
    listeners.add(
      view.onPluginEvent('group-a.search-change', (payload) => {
        if (disposed) return;
        try {
          const event = searchRecord(payload);
          if (event.kind !== 'mentions') return;
          if (event.callback === undefined)
            throw new Error('Missing native inline-search callback');
          if (initialize()) apply(event);
          else pending.push(event);
        } catch (error) {
          unavailable(error);
        }
      })
    );
    releaseReady = view.onCommit(() => {
      if (initialized || disposed) return;
      try {
        initialize();
      } catch (error) {
        unavailable(error);
      }
    });
    listeners.add(stopReady);
    initialize();
    return dispose;
  } catch (error) {
    unavailable(error);
    return dispose;
  }
}
