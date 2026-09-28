import { $diffNodeDeleteAtStart } from '@macro-inc/lexical-core';
import type { LexicalEditor } from 'lexical';
import { COMMAND_PRIORITY_CRITICAL } from 'lexical';
import { mapRegisterDelete } from '../shared/utils';

function registerDiffPlugin(editor: LexicalEditor) {
  return mapRegisterDelete(
    editor,
    () => {
      return $diffNodeDeleteAtStart();
    },
    COMMAND_PRIORITY_CRITICAL
  );
}

/** The diff plugin registers the listeners for diff nodes. */
export function diffPlugin() {
  return (editor: LexicalEditor) => {
    return registerDiffPlugin(editor);
  };
}
