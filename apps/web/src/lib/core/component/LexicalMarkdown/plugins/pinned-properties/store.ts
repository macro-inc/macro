// Shared by both engines and loaded by every document open: keep native code out
// (the native store is in ./native, which only the lazy native editor imports).
import type { LexicalEditor } from 'lexical';
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
