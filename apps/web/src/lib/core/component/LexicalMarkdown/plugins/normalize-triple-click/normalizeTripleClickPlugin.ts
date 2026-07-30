import { mergeRegister } from '@lexical/utils';
import {
  $caretRangeFromSelection,
  $getCaretRange,
  $getCaretRangeInDirection,
  $getChildCaret,
  $getEditor,
  $getPreviousSelection,
  $getSelection,
  $getSiblingCaret,
  $isChildCaret,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isSiblingCaret,
  $isTextPointCaret,
  $normalizeCaret,
  $rewindSiblingCaret,
  $setSelectionFromCaretRange,
  $updateDOMSelection,
  COMMAND_PRIORITY_BEFORE_CRITICAL,
  getDOMSelection,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
  SKIP_SELECTION_FOCUS_TAG,
} from 'lexical';

const SKIP_TAGS = new Set([
  SKIP_SELECTION_FOCUS_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
]);

// Need a frame or two between the mouse events and the resulting
// selectionchange for a triple click.
const TRIPLE_CLICK_THRESHOLD_MS = 100;

/**
 * Triple-clicking a block causes the browser to expand the selection to cover
 * the entire block, but it leaves the focus point at offset 0 of the *next*
 * block. Visually it looks like a single block is selected, but the selection
 * actually extends one position into the following block.
 *
 * Without correcting this, deleting a triple-selected node merges the
 * heading with the node below it.
 *
 * This mirrors `NormalizeTripleClickSelectionExtension` from `@lexical/extension`,
 * classic `registerRichText` used here does not. It moves the focus back so it
 * prefers the end of a node over the start of its next sibling, and it does not
 * skip over a `LineBreakNode`.
 */
export function $fixFocusOverselection(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return;
  }

  const range = $getCaretRangeInDirection(
    $caretRangeFromSelection(selection),
    'next'
  );
  let focusCaret = range.focus;

  // Move it out of the next TextNode if none of it is selected.
  if (
    $isTextPointCaret(focusCaret) &&
    range.anchor.origin !== focusCaret.origin &&
    focusCaret.offset === 0
  ) {
    focusCaret = $rewindSiblingCaret(focusCaret.getSiblingCaret());
  }
  // Move it behind a single LineBreakNode.
  if (
    $isSiblingCaret(focusCaret) &&
    range.anchor.origin !== focusCaret.origin &&
    $isLineBreakNode(focusCaret.origin)
  ) {
    focusCaret = $rewindSiblingCaret(focusCaret);
  }
  // Move the focus out of the start of any elements.
  while (
    $isChildCaret(focusCaret) &&
    range.anchor.origin !== focusCaret.origin
  ) {
    focusCaret = $rewindSiblingCaret(
      $getSiblingCaret(focusCaret.origin, 'next')
    );
  }
  // Move it inside the containing element.
  if ($isSiblingCaret(focusCaret) && $isElementNode(focusCaret.origin)) {
    focusCaret = $normalizeCaret(
      $getChildCaret(focusCaret.origin, 'previous')
    ).getFlipped();
  }
  focusCaret = $normalizeCaret(focusCaret);

  if (focusCaret.isSamePointCaret(range.focus)) {
    return;
  }

  const sel = $setSelectionFromCaretRange(
    $getCaretRange(range.anchor, focusCaret)
  );
  const editor = $getEditor();
  const rootElement = editor.getRootElement();
  const domSelection =
    rootElement && getDOMSelection(rootElement.ownerDocument.defaultView);
  if (rootElement && domSelection) {
    // Eagerly fix up the DOM selection to avoid a flash of over-selection.
    $updateDOMSelection(
      $getPreviousSelection(),
      sel,
      editor,
      domSelection,
      SKIP_TAGS,
      rootElement
    );
  }
}

function registerNormalizeTripleClickPlugin(editor: LexicalEditor) {
  return editor.registerRootListener((rootElement) => {
    if (!rootElement) {
      return;
    }

    let lastTripleClick = 0;
    const refreshTripleClick = (event: MouseEvent | null): number => {
      if (event ? event.detail === 3 : lastTripleClick > 0) {
        const now = Date.now();
        lastTripleClick =
          (event && event.type === 'mousedown') ||
          now - lastTripleClick <= TRIPLE_CLICK_THRESHOLD_MS
            ? now
            : 0;
      }
      return lastTripleClick;
    };

    const events: Array<keyof HTMLElementEventMap> = ['mouseup', 'mousedown'];
    const listener = (event: Event) => refreshTripleClick(event as MouseEvent);

    return mergeRegister(
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          if (refreshTripleClick(null)) {
            lastTripleClick = 0;
            $fixFocusOverselection();
          }
          return false;
        },
        COMMAND_PRIORITY_BEFORE_CRITICAL
      ),
      (() => {
        for (const eventName of events) {
          rootElement.addEventListener(eventName, listener, true);
        }
        return () => {
          for (const eventName of events) {
            rootElement.removeEventListener(eventName, listener, true);
          }
        };
      })()
    );
  });
}

/**
 * Normalizes browser triple-click over-selection so that selecting a block and
 * then deleting or reformatting it does not bleed into the following block.
 */
export function normalizeTripleClickPlugin() {
  return (editor: LexicalEditor) => {
    return registerNormalizeTripleClickPlugin(editor);
  };
}
