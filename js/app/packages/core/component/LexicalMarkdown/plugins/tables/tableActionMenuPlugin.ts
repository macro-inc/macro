import {
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableSelection,
  getTableElement,
  getTableObserverFromTableElement,
  TableCellNode,
  TableNode,
  type TableObserver,
} from '@lexical/table';
import { mergeRegister } from '@lexical/utils';
import { createCallback } from '@solid-primitives/rootless';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  getDOMSelection,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import type { Accessor } from 'solid-js';
import { nodeByKey } from '../../utils';
import { registerEditorWidthObserver } from '../shared/utils';

export interface TableActionsMenuPluginProps {
  menuButtonRef: Accessor<HTMLDivElement | undefined>;
  anchorElem: Accessor<HTMLElement | undefined>;
  tableCellNodeKey: Accessor<string | undefined>;
  setTableCellNodeKey: (cellNode: string | null) => void;
}

const checkTableCellOverflow = createCallback(
  (tableCellParentNodeDOM: HTMLElement): boolean => {
    const scrollableContainer = tableCellParentNodeDOM.closest(
      '.md-table-scrollable-wrapper'
    );
    if (scrollableContainer) {
      const containerRect = (
        scrollableContainer as HTMLElement
      ).getBoundingClientRect();
      const cellRect = tableCellParentNodeDOM.getBoundingClientRect();

      // Calculate where the action button would be positioned (5px from right edge of cell)
      // Also account for the button width and table cell padding (8px)
      const actionButtonRight = cellRect.right - 5;
      const actionButtonLeft = actionButtonRight - 28; // 20px width + 8px padding

      // Only hide if the action button would overflow the container
      if (
        actionButtonRight > containerRect.right ||
        actionButtonLeft < containerRect.left
      ) {
        return true;
      }
    }
    return false;
  }
);

function registerTableActionMenuPlugin(
  editor: LexicalEditor,
  props: TableActionsMenuPluginProps
) {
  const $moveMenu = createCallback(() => {
    const menu = props.menuButtonRef();

    function disable() {
      if (menu) {
        menu.classList.remove('table-cell-action-button-container--active');
        menu.classList.add('table-cell-action-button-container--inactive');
      }
      props.setTableCellNodeKey(null);
    }

    if (!menu) {
      return disable();
    }

    const selection = $getSelection();
    const nativeSelection = getDOMSelection(editor._window);
    const activeElement = document.activeElement;

    if (selection === null || menu === null) {
      return disable();
    }

    const rootElement = editor.getRootElement();
    let tableObserver: TableObserver | null = null;
    let tableCellParentNodeDOM: HTMLElement | null = null;
    let tableCellNodeFromSelection: TableCellNode | null = null;

    if (
      $isRangeSelection(selection) &&
      rootElement !== null &&
      nativeSelection !== null &&
      rootElement.contains(nativeSelection.anchorNode)
    ) {
      tableCellNodeFromSelection = $getTableCellNodeFromLexicalNode(
        selection.anchor.getNode()
      );

      if (!tableCellNodeFromSelection) {
        return disable();
      }

      tableCellParentNodeDOM = editor.getElementByKey(
        tableCellNodeFromSelection.getKey()
      );

      if (
        tableCellParentNodeDOM === null ||
        !tableCellNodeFromSelection.isAttached()
      ) {
        return disable();
      }

      if (checkTableCellOverflow(tableCellParentNodeDOM)) {
        return disable();
      }

      const tableNode = $getTableNodeFromLexicalNodeOrThrow(
        tableCellNodeFromSelection
      );
      const tableElement = getTableElement(
        tableNode,
        editor.getElementByKey(tableNode.getKey())
      );

      if (!tableElement) {
        return disable();
      }
      tableObserver = getTableObserverFromTableElement(tableElement);
    } else if ($isTableSelection(selection)) {
      const anchorNode = $getTableCellNodeFromLexicalNode(
        selection.anchor.getNode()
      );

      if (!$isTableCellNode(anchorNode)) {
        return disable();
      }

      const tableNode = $getTableNodeFromLexicalNodeOrThrow(anchorNode);
      const tableElement = getTableElement(
        tableNode,
        editor.getElementByKey(tableNode.getKey())
      );

      if (!tableElement) {
        return disable();
      }

      tableObserver = getTableObserverFromTableElement(tableElement);
      tableCellParentNodeDOM = editor.getElementByKey(anchorNode.getKey());
    } else if (!activeElement) {
      return disable();
    }

    if (!tableObserver || !tableCellParentNodeDOM) {
      return disable();
    }

    const enabled = !tableObserver || !tableObserver.isSelecting;
    const _anchorElem = props.anchorElem();

    if (
      enabled &&
      _anchorElem &&
      tableCellParentNodeDOM &&
      tableCellNodeFromSelection
    ) {
      props.setTableCellNodeKey(tableCellNodeFromSelection.getKey());

      menu.classList.toggle(
        'table-cell-action-button-container--active',
        enabled
      );
      menu.classList.toggle(
        'table-cell-action-button-container--inactive',
        !enabled
      );

      // Calculate position
      const tableCellRect = tableCellParentNodeDOM.getBoundingClientRect();
      const anchorRect = _anchorElem.getBoundingClientRect();
      const top = tableCellRect.top - anchorRect.top;
      const left = tableCellRect.right - anchorRect.left;
      const offsetX = -35;
      const offsetY = 10;

      // Set positioning
      menu.style.position = 'absolute';
      menu.style.top = '0';
      menu.style.left = '0';
      menu.style.transform = `translate(${left + offsetX}px, ${top + offsetY}px)`;
    }
  });

  // Handle delayed callback for menu movement
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const delayedCallback = (delay = 10) => {
    if (!timeoutId) {
      timeoutId = setTimeout(() => {
        timeoutId = undefined;
        editor.read($moveMenu);
      }, delay);
    }
    return false;
  };

  return mergeRegister(
    editor.registerUpdateListener(() => delayedCallback(100)),

    editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => delayedCallback(0),
      COMMAND_PRIORITY_CRITICAL
    ),

    editor.registerRootListener((rootElement, prevRootElement) => {
      const noDelayCallback = () => delayedCallback(0);
      if (prevRootElement) {
        prevRootElement.removeEventListener('pointerup', noDelayCallback);
      }
      if (rootElement) {
        rootElement.addEventListener('pointerup', noDelayCallback);
        noDelayCallback();
      }
    }),

    // Add table scroll listeners.
    editor.registerMutationListener(
      TableNode,
      (mutations) => {
        for (const [key, mutation] of mutations) {
          if (mutation === 'created') {
            const tableElement = editor.getElementByKey(key);
            if (tableElement) {
              tableElement.addEventListener('scroll', () => delayedCallback(0));
            }
          }
        }
      },
      { skipInitialization: false }
    ),

    registerEditorWidthObserver(editor, () => {
      delayedCallback();
    }),

    editor.registerMutationListener(
      TableCellNode,
      createCallback((nodeMutations) => {
        const _tableCellNodeKey = props.tableCellNodeKey();
        if (!_tableCellNodeKey) return;

        const _tableCellNode = nodeByKey(editor, _tableCellNodeKey);
        if (!_tableCellNode) return;

        const nodeUpdated =
          nodeMutations.get(_tableCellNode.getKey()) === 'updated';
        if (nodeUpdated) {
          editor.read(() => {
            props.setTableCellNodeKey(_tableCellNode.getLatest().getKey());
          });
        }
      }),
      { skipInitialization: true }
    ),

    () => clearTimeout(timeoutId)
  );
}

export function tableActionMenuPlugin(props: TableActionsMenuPluginProps) {
  return (editor: LexicalEditor) =>
    registerTableActionMenuPlugin(editor, props);
}
