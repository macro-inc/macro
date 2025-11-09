import { mergeRegister } from '@lexical/utils';
import { $isSelectionInsideCode } from '@lexical-core';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';
import type { Accessor } from 'solid-js';
import { $getCaretRect, isRectFlushWith } from '../../utils';

export type KeyboardFocusPluginProps = {
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  onFocusLeaveEnd?: (e: KeyboardEvent) => void;
  ignoreKeys: Accessor<boolean>;
};

function registerKeyboardFocusPlugin(
  editor: LexicalEditor,
  props: KeyboardFocusPluginProps
) {
  function $testSelectionPosition(
    side: 'start' | 'end',
    direction: 'horizontal' | 'vertical'
  ): boolean {
    const lexicalSelection = $getSelection();

    if (!$isRangeSelection(lexicalSelection)) return false;
    if (!lexicalSelection.isCollapsed()) return false;
    if ($isSelectionInsideCode(lexicalSelection)) return false;

    if (direction === 'vertical') {
      const rect = editor.getRootElement()?.getBoundingClientRect();
      if (!rect) return false;
      const caret = $getCaretRect();
      if (!caret) return false;
      if (side === 'end') {
        return isRectFlushWith(caret, rect, 'bottom', 5);
      }
      return isRectFlushWith(caret, rect, 'top', 5);
    }

    // horizontal case
    const anchorNode = lexicalSelection.anchor.getNode();
    const parent = anchorNode.getParent();
    const root = $getRoot();

    if (side === 'start') {
      if (
        lexicalSelection.anchor.offset !== 0 ||
        anchorNode.getIndexWithinParent() !== 0
      ) {
        return false;
      }
      if (parent !== root.getFirstChild() && parent !== root) {
        return false;
      }
      return true;
    }

    const len = anchorNode.getTextContent().length;
    if (lexicalSelection.anchor.offset !== len) return false;
    if (parent?.getLastChild() !== anchorNode) return false;

    return true;
  }

  return mergeRegister(
    editor.registerCommand(
      KEY_TAB_COMMAND,
      (e: KeyboardEvent) => {
        if (props.ignoreKeys()) return true;
        if (e.shiftKey) {
          if ($testSelectionPosition('start', 'horizontal')) {
            props.onFocusLeaveStart?.(e);
            return true;
          }
          return false;
        }
        if ($testSelectionPosition('end', 'horizontal')) {
          props.onFocusLeaveEnd?.(e);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      (e: KeyboardEvent) => {
        if (props.ignoreKeys()) return true;
        if ($testSelectionPosition('start', 'horizontal')) {
          props.onFocusLeaveStart?.(e);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      (e: KeyboardEvent) => {
        if (props.ignoreKeys()) return true;
        if ($testSelectionPosition('end', 'horizontal')) {
          props.onFocusLeaveEnd?.(e);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      (e: KeyboardEvent) => {
        if (props.ignoreKeys()) return true;
        if ($testSelectionPosition('start', 'horizontal')) {
          props.onFocusLeaveStart?.(e);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    ),
    editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (e: KeyboardEvent) => {
        if (props.ignoreKeys()) return true;
        if ($testSelectionPosition('end', 'horizontal')) {
          props.onFocusLeaveEnd?.(e);
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH
    )
  );
}

export function keyboardFocusPlugin(props: KeyboardFocusPluginProps) {
  return (editor: LexicalEditor) => {
    return registerKeyboardFocusPlugin(editor, props);
  };
}
