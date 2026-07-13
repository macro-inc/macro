/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */
import { TableNode } from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';
import { MIN_COLUMN_WIDTH } from '../../component/misc/TableCellResizer';

function registerTableCellResizerPlugin(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerNodeTransform(TableNode, (tableNode) => {
      if (tableNode.getColWidths()) {
        return tableNode;
      }

      const numColumns = tableNode.getColumnCount();
      const columnWidth = MIN_COLUMN_WIDTH;

      tableNode.setColWidths(Array(numColumns).fill(columnWidth));
      return tableNode;
    })
  );
}

export function tableCellResizerPlugin() {
  return (editor: LexicalEditor) => registerTableCellResizerPlugin(editor);
}
