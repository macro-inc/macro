import {
  registerTableCellUnmergeTransform,
  registerTablePlugin,
  registerTableSelectionObserver,
  setScrollableTablesActive,
  TableCellNode,
} from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import {
  $salvageTableCellChildren,
  TABLE_CELL_ALLOWED_CHILD_TYPES,
} from '@macro-inc/lexical-core/utils/editor-tree';
import { Telemetry } from '@macro-inc/observability';
import type { LexicalEditor } from 'lexical';
import { registerTableListTab } from './tableListTab';
import { registerTableSelectAll } from './tableSelectAll';
import { registerTableTabInsertRow } from './tableTabInsertRow';
import { registerTableTouchDragGuard } from './tableTouchDragGuard';

interface TablePluginProps {
  // When `false` (default `true`), merged cell support (colspan and rowspan) will be disabled and all
  // tables will be forced into a regular grid with 1x1 table cells.
  hasCellMerge?: boolean;
  // When `false` (default `true`), the background color of TableCellNode will always be removed.
  hasCellBackgroundColor?: boolean;
  // When `true` (default `true`), the tab key can be used to navigate table cells.
  hasTabHandler?: boolean;
  // When `true` (default `false`), tables will be wrapped in a `<div>` to enable horizontal scrolling
  hasHorizontalScroll?: boolean;
  /** Owning document id, used when normalization has to salvage stray cell children. */
  documentId?: string;
}

function _registerTablePlugin(editor: LexicalEditor, props: TablePluginProps) {
  setScrollableTablesActive(editor, props.hasHorizontalScroll ?? false);

  return mergeRegister(
    // Register the table plugin
    registerTablePlugin(editor),

    // Register the table selection observer
    registerTableSelectionObserver(editor, props.hasTabHandler ?? true),

    // Keep the observer's pointer drag from turning a scroll into a cell
    // selection on touch (see tableTouchSelection for the touch gesture)
    registerTableTouchDragGuard(editor),

    // Let list items claim Tab for indentation before cell navigation
    (props.hasTabHandler ?? true) ? registerTableListTab(editor) : () => {},

    // Tab in the bottom-right cell grows the table with a new row (registered
    // after tableListTab so list indentation still wins when it applies)
    (props.hasTabHandler ?? true)
      ? registerTableTabInsertRow(editor)
      : () => {},

    // Ctrl/Cmd+A inside a table selects the table before the document
    registerTableSelectAll(editor),

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

    // Restrict table cells to block content that renders sanely inside them
    // (notably: no nested tables). Stray inlines/text are wrapped in a
    // paragraph instead of dropped, and the salvage is logged with the
    // document id so a silent wipe pages.
    (() => {
      return editor.registerNodeTransform(TableCellNode, (node) => {
        const children = node.getChildren();
        const alreadyValid = children.every((child) =>
          TABLE_CELL_ALLOWED_CHILD_TYPES.has(child.__type)
        );
        if (alreadyValid) return;

        const result = $salvageTableCellChildren(node);
        if (
          result.salvagedTypes.length === 0 &&
          result.removedTypes.length === 0
        ) {
          return;
        }
        Telemetry.error(
          'table cell normalization salvaged stray children',
          {
            document_id: props.documentId ?? 'unknown',
            salvaged_types: result.salvagedTypes,
            removed_types: result.removedTypes,
            salvaged_count: result.salvagedTypes.length,
            removed_count: result.removedTypes.length,
          }
        );
      });
    })()
  );
}

export function tablePlugin(props: TablePluginProps) {
  return (editor: LexicalEditor) => _registerTablePlugin(editor, props);
}
