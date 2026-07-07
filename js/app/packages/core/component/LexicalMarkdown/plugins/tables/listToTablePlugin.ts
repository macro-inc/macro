import type { LexicalEditor } from 'lexical';
import { registerListToTableCommand } from './listToTable';

/** List → table conversion: registers LIST_TO_TABLE_COMMAND. */
export function listToTablePlugin() {
  return (editor: LexicalEditor) => registerListToTableCommand(editor);
}
