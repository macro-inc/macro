import { INSERT_TABLE_COMMAND } from '@lexical/table';
import type { LexicalEditor } from 'lexical';
import type { Accessor } from 'solid-js';
import { type PluginManager, tablePickerPlugin } from '../../plugins';
import type { TablePickerHost } from './table-picker';

/** Preserve the Source plugin owner and dynamic editor/manager accessors. */
export function createLexicalTablePickerHost(
  editor: Accessor<LexicalEditor | undefined>,
  plugins: Accessor<PluginManager | undefined>
): TablePickerHost {
  return {
    root: () => editor()?.getRootElement() ?? null,
    focus: () => editor()?.focus(),
    insert(rows, columns) {
      editor()?.dispatchCommand(INSERT_TABLE_COMMAND, {
        columns: `${columns}`,
        rows: `${rows}`,
        includeHeaders: false,
      });
    },
    registerPicker(canEdit, onCreate) {
      const currentPlugins = plugins();
      if (!currentPlugins) return;
      currentPlugins.useReactive(canEdit, () => {
        if (!canEdit()) return;
        return tablePickerPlugin({ onCreateTable: onCreate });
      });
    },
  };
}
