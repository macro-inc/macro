import { $convertToMarkdownString } from '@lexical/markdown';
import { ALL_TRANSFORMERS } from '@lexical-core';
import { useUpdateInstructionsMdTextCache } from '@service-storage/instructionsMd';
import { debounce } from '@solid-primitives/scheduled';
import { $getRoot, type LexicalEditor, type UpdateListener } from 'lexical';

const DEFAULT_DEBOUNCE_TIME = 300;

export type UserPromptPluginProps = {
  documentId: string;
  debounceTime?: number;
  storageKey?: string;
};

function registerUserPromptPlugin(
  editor: LexicalEditor,
  props: UserPromptPluginProps,
  updateCache: (text: string) => void
) {
  const debounceTime = props.debounceTime || DEFAULT_DEBOUNCE_TIME;

  const updateQueryCache: UpdateListener = ({ editorState }) => {
    const markdownText = editorState.read(() => {
      const root = $getRoot();
      return $convertToMarkdownString(ALL_TRANSFORMERS, root);
    });

    try {
      // Update the query cache directly with the new text
      updateCache(markdownText);
    } catch (error) {
      console.warn('Failed to update instructions query cache:', error);
    }
  };

  const debouncedSave = debounce(updateQueryCache, debounceTime);
  return editor.registerUpdateListener(debouncedSave);
}

export function useUserPromptPlugin(props: UserPromptPluginProps) {
  const updateCache = useUpdateInstructionsMdTextCache();
  return (editor: LexicalEditor) =>
    registerUserPromptPlugin(editor, props, updateCache);
}
