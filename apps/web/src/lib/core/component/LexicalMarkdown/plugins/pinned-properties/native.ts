import type { EditorView } from '@macro-inc/lexical-wasm-view';
import {
  dispatchApplicationCommand,
  queryApplication,
} from '../group-b/command';
import type { PinnedPropertyStore } from './store';

function readNative(view: EditorView): string[] | undefined {
  const reply = queryApplication(view, 'group-b.pinned-properties', {});
  if (reply === null) return undefined;
  if (typeof reply !== 'object' || !('ids' in reply))
    throw new Error('Invalid pinned properties query');
  const { ids } = reply;
  if (ids === null) return undefined;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string'))
    throw new Error('Invalid pinned properties query');
  return ids;
}

export function nativePinnedPropertyStore(
  view: EditorView
): PinnedPropertyStore {
  return {
    read: () => readNative(view),
    subscribe: (listener) => view.onCommit(() => listener()),
    update: (plan) => {
      const operations = plan(readNative(view));
      if (!operations.length) return;
      dispatchApplicationCommand(view, 'group-b.pinned-properties', {
        operations: operations.map(({ id, pin }) => ({ id, pin })),
      });
    },
  };
}
