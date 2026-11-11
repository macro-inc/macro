import type { EditorView } from '@macro-inc/lexical-wasm-view';
import type { LexicalEditor } from 'lexical';
import {
  dispatchApplicationCommand,
  queryApplication,
} from '../group-b/command';
import {
  $getStoredPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from './pinnedPropertiesPlugin';

export interface PinOperation {
  readonly id: string;
  readonly pin: boolean;
}

/** Root pinned-property state of one document body. */
export interface PinnedPropertyStore {
  /** Stored pins, or undefined while the document never stored any. */
  read(): string[] | undefined;
  subscribe(listener: () => void): () => void;
  /** Plan ordered pin operations against the current pins and apply them in one update. */
  update(plan: (stored: string[] | undefined) => PinOperation[]): void;
}

export function lexicalPinnedPropertyStore(
  editor: LexicalEditor
): PinnedPropertyStore {
  return {
    read: () => editor.getEditorState().read($getStoredPinnedProperties),
    subscribe: (listener) =>
      editor.registerUpdateListener(() => {
        listener();
      }),
    update: (plan) =>
      editor.update(() => {
        for (const { id, pin } of plan($getStoredPinnedProperties()))
          editor.dispatchCommand(
            pin ? ADD_PINNED_PROPERTY_COMMAND : REMOVE_PINNED_PROPERTY_COMMAND,
            id
          );
      }),
  };
}

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
