import {
  $getSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical';

type TablePickerPluginProps = {
  onCreateTable: () => void;
};

/**
 * Requests the table size picker UI. Handled by FloatingTableMenu when
 * mounted; dispatchers should fall back to a direct insert when this
 * returns false.
 */
export const TRY_INSERT_TABLE_PICKER_COMMAND: LexicalCommand<void> =
  createCommand('TRY_INSERT_TABLE_PICKER_COMMAND');

function registerTablePickerPlugin(
  editor: LexicalEditor,
  props: TablePickerPluginProps
) {
  return editor.registerCommand(
    TRY_INSERT_TABLE_PICKER_COMMAND,
    () => {
      const selection = $getSelection();
      if (!selection) {
        return false;
      }
      props.onCreateTable();
      return true;
    },
    COMMAND_PRIORITY_NORMAL
  );
}

export function tablePickerPlugin(props: TablePickerPluginProps) {
  return (editor: LexicalEditor) => registerTablePickerPlugin(editor, props);
}
