import {
  $getPinnedProperties,
  ADD_PINNED_PROPERTY_COMMAND,
  REMOVE_PINNED_PROPERTY_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/pinned-properties/pinnedPropertiesPlugin';
import type { LexicalEditor } from 'lexical';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/** Observe and update the pins persisted in the collaborative document. */
export function createPinnedProperties(
  editor: Accessor<LexicalEditor | undefined>
) {
  const [ids, setIds] = createSignal<string[]>([]);
  createEffect(() => {
    const current = editor();
    if (!current) return;
    current.getEditorState().read(() => setIds($getPinnedProperties()));
    onCleanup(
      current.registerUpdateListener(({ editorState }) => {
        editorState.read(() => setIds($getPinnedProperties()));
      })
    );
  });
  return {
    ids,
    pin: (id: string) =>
      editor()?.dispatchCommand(ADD_PINNED_PROPERTY_COMMAND, id),
    unpin: (id: string) =>
      editor()?.dispatchCommand(REMOVE_PINNED_PROPERTY_COMMAND, id),
  };
}
