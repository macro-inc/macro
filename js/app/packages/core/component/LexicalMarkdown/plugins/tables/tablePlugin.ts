import {
  registerTableCellUnmergeTransform,
  registerTablePlugin,
  registerTableSelectionObserver,
  setScrollableTablesActive,
  TableCellNode,
} from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import type { LexicalEditor } from 'lexical';

export interface TablePluginProps {
  // When `false` (default `true`), merged cell support (colspan and rowspan) will be disabled and all
  // tables will be forced into a regular grid with 1x1 table cells.
  hasCellMerge?: boolean;
  // When `false` (default `true`), the background color of TableCellNode will always be removed.
  hasCellBackgroundColor?: boolean;
  // When `true` (default `true`), the tab key can be used to navigate table cells.
  hasTabHandler?: boolean;
  // When `true` (default `false`), tables will be wrapped in a `<div>` to enable horizontal scrolling
  hasHorizontalScroll?: boolean;
}

function _registerTablePlugin(editor: LexicalEditor, props: TablePluginProps) {
  setScrollableTablesActive(editor, props.hasHorizontalScroll ?? false);

  return mergeRegister(
    // Register the table plugin
    registerTablePlugin(editor),

    // Register the table selection observer
    registerTableSelectionObserver(editor, props.hasTabHandler ?? true),

    // Unmerge cells when the feature isn't enabled
    (() => {
      return !props.hasCellMerge
        ? registerTableCellUnmergeTransform(editor)
        : () => {};
    })(),

    // Remove cell background color when feature is disabled
    (() => {
      if (props.hasCellBackgroundColor) return () => {};
      return editor.registerNodeTransform(TableCellNode, (node) => {
        if (node.getBackgroundColor() !== null) {
          node.setBackgroundColor(null);
        }
      });
    })(),

    // Only allow paragraph nodes within Table Cells
    (() => {
      const allowedNodesInTableCellNode = ['paragraph'];
      return editor.registerNodeTransform(TableCellNode, (node) => {
        const children = node.getChildren();

        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (!allowedNodesInTableCellNode.includes(child.__type)) {
            child.remove();
          }
        }
      });
    })()
  );
}

export function tablePlugin(props: TablePluginProps) {
  return (editor: LexicalEditor) => _registerTablePlugin(editor, props);
}
