import { createCommand, type LexicalEditor } from 'lexical';

/** Resolve after the editor's current state has been synchronized and acknowledged. */
export const FLUSH_COLLABORATION_COMMAND = createCommand<
  (acked: boolean) => void
>('FLUSH_COLLABORATION_COMMAND');

export function flushCollaboration(editor: LexicalEditor): Promise<boolean> {
  return new Promise((resolve) => {
    if (!editor.dispatchCommand(FLUSH_COLLABORATION_COMMAND, resolve))
      resolve(false);
  });
}
