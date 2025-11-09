import { IS_MAC } from '@core/constant/isMac';
import {
  $insertList,
  $isListItemNode,
  INSERT_CHECK_LIST_COMMAND,
  type ListItemNode,
} from '@lexical/list';
import { mergeRegister } from '@lexical/utils';
import {
  $getNearestNodeFromDOMNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  getNearestEditorFromDOMNode,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

/**
 * Lexical uses psuedo-elements to draw the checks. This logic detects if a
 * click is close enough to a li::before as set up in the css override file.
 */
function boundsCheck(rect: DOMRect, x: number, y: number): boolean {
  const oneRem = parseFloat(
    getComputedStyle(document.documentElement).fontSize
  );
  const { left, top } = rect;
  const CLICK_BUFFER = 10;
  if (
    x >= left - CLICK_BUFFER - oneRem * 1.25 &&
    x <= left + CLICK_BUFFER &&
    y >= top - CLICK_BUFFER &&
    y <= y + CLICK_BUFFER + oneRem
  ) {
    return true;
  }
  return false;
}

/**
 * Wrap a mouseEvent-handling callback in a series of checks. 1) Element was
 * clicked, 2) Element on the correct Editor, 3) Editor is editable.
 */
function wrapCheckboxMouseEvent(
  e: MouseEvent,
  editor: LexicalEditor,
  callback: (e: MouseEvent) => void
) {
  const { target } = e;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const clickedEditor = getNearestEditorFromDOMNode(target);
  if (clickedEditor !== editor) {
    return;
  }
  if (editor !== null && editor.isEditable()) {
    callback(e);
  }
}

/**
 * Register the listeners for clicking check boxes.
 * @param editor - The editor
 * @return The teardown function.
 */
function registerMouseEvents(editor: LexicalEditor) {
  const mouseDownPosition = [0, 0];

  function click(e: MouseEvent) {
    wrapCheckboxMouseEvent(e, editor, (e: MouseEvent) => {
      editor.update(() => {
        const { target, clientX, clientY } = e;
        if (!(target instanceof HTMLElement)) return;

        const nearest = $getNearestNodeFromDOMNode(target);
        if ($isListItemNode(nearest)) {
          if (boundsCheck(target.getBoundingClientRect(), clientX, clientY)) {
            if (
              Math.abs(mouseDownPosition[0] - clientX) < 5 &&
              Math.abs(mouseDownPosition[1] - clientY) < 5
            ) {
              nearest.toggleChecked();
            }
          }
        }
      });
    });
  }

  /**
   * Prevent default on checkbox mousedown to avoid focus change.
   */
  function mousedown(e: MouseEvent) {
    wrapCheckboxMouseEvent(e, editor, (e) => {
      editor.read(() => {
        const { target, clientX, clientY } = e;
        if (!(target instanceof HTMLElement)) return;
        const nearest = $getNearestNodeFromDOMNode(target);
        if ($isListItemNode(nearest)) {
          if (boundsCheck(target.getBoundingClientRect(), clientX, clientY)) {
            mouseDownPosition[0] = clientX;
            mouseDownPosition[1] = clientY;
            e.preventDefault();
          }
        }
      });
    });
  }

  return editor.registerRootListener((root, prevRoot) => {
    if (root) {
      root.addEventListener('click', click);
      root.addEventListener('mousedown', mousedown);
    }
    if (prevRoot) {
      prevRoot.removeEventListener('click', click);
      prevRoot.removeEventListener('mousedown', mousedown);
    }
  });
}

/**
 * Toggle the check boxes in a selection.
 */
function toggleChecksInSelection(editor: LexicalEditor) {
  editor.update(() => {
    const listItemNodes: Set<ListItemNode> = new Set();

    // If multiple check nodes are selected, we want to toggle them all to
    // the opposite state of the first node selected, rather than just toggle.
    let firstNodeChecked: boolean | undefined;

    const selection = $getSelection();
    if (!$isRangeSelection(selection)) {
      return;
    }

    const nodes = selection.getNodes();
    const root = $getRoot();

    // Find all unique list items in the selection.
    for (const node of nodes) {
      let current: LexicalNode | null = node;
      while (current && current !== root && current.getParent() !== root) {
        if ($isListItemNode(current)) {
          if (firstNodeChecked === undefined) {
            firstNodeChecked = (current as ListItemNode).getChecked();
          }
          listItemNodes.add(current);
          break;
        }
        current = current.getParent();
      }
    }

    for (const listItemNode of listItemNodes) {
      if (firstNodeChecked === undefined) {
        listItemNode.toggleChecked();
      } else {
        if (listItemNode.getChecked() === firstNodeChecked) {
          listItemNode.toggleChecked();
        }
      }
    }
  });
}

function registerChecklistPlugin(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerCommand(
      INSERT_CHECK_LIST_COMMAND,
      () => {
        $insertList('check');
        return true;
      },
      COMMAND_PRIORITY_LOW
    ),
    registerMouseEvents(editor),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e: KeyboardEvent) => {
        // Meta+Enter toggles check state.
        const isCommand = IS_MAC ? e.metaKey : e.ctrlKey;
        if (isCommand && !e.shiftKey) {
          toggleChecksInSelection(editor);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW // Set to LOW to avoid being swallowed by regular KEY_ENTER_COMMAND handler
    )
  );
}

export function checklistPlugin() {
  return (editor: LexicalEditor) => {
    return registerChecklistPlugin(editor);
  };
}
