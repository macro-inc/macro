import { $updateAllNodeIds, type NodeIdMappings } from '@lexical-core';
import type { LexicalEditor, SerializedEditorState } from 'lexical';
import { createLexicalWrapper } from '../context/LexicalWrapperContext';
import {
  initializeEditorEmpty,
  initializeEditorWithState,
  setEditorStateFromMarkdown,
} from '../utils';

function tryParseJson(raw: string): Object | undefined {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return undefined;
  }
}

type InitializationValue = SerializedEditorState | string | undefined;
type StateSetter = (
  editor: LexicalEditor,
  state: InitializationValue,
  ...args: any[]
) => any;

function setAndGetStateWithNodeIds(
  setter: StateSetter,
  editor: LexicalEditor,
  state: InitializationValue,
  mapping: NodeIdMappings
): SerializedEditorState | undefined {
  setter(editor, state);
  editor.update(
    () => {
      $updateAllNodeIds(mapping);
    },
    {
      discrete: true,
    }
  );

  const serialized = editor.getEditorState().toJSON();

  return serialized;
}

/**
 * Parse a blob into a serialized editor state.
 */
export async function serializedStateFromBlob(
  blob: Blob
): Promise<SerializedEditorState | undefined> {
  const raw = new TextDecoder().decode(await blob.arrayBuffer());

  const ephemeralLexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'ephemeral-block-md',
    isInteractable: () => false,
    withIds: true,
  });

  let state: SerializedEditorState | undefined;

  let maybeJson = tryParseJson(raw);

  let value = (maybeJson as SerializedEditorState) ?? raw;
  let setter = maybeJson
    ? initializeEditorWithState
    : setEditorStateFromMarkdown;

  state = setAndGetStateWithNodeIds(
    setter,
    ephemeralLexicalWrapper.editor,
    value,
    ephemeralLexicalWrapper.mapping
  );

  return state;
}

export async function createMarkdownStateFromContent(
  content: string | undefined
) {
  const ephemeralLexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'ephemeral-block-md',
    isInteractable: () => false,
    withIds: true,
  });

  if (content) {
    setEditorStateFromMarkdown(ephemeralLexicalWrapper.editor, content);
  } else {
    initializeEditorEmpty(ephemeralLexicalWrapper.editor);
  }

  const serialized = ephemeralLexicalWrapper.editor.getEditorState().toJSON();

  return serialized;
}
