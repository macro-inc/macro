import { IS_MAC } from '@core/constant/isMac';
import { mergeRegister } from '@lexical/utils';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  FORMAT_TEXT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type RangeSelection,
  type TextFormatType,
} from 'lexical';
import { $isAtEndOfTextNode } from '../../utils';

const META_OR_CTRL = IS_MAC ? 'meta' : 'ctrl';

// Inline formats without well known key commands (ie cmd+b) should use right
// arrow as an escape hatch.
const escapableInlineFormats: TextFormatType[] = [
  'code',
  'highlight',
  'strikethrough',
] as const;

const $shouldEscapeRight = (selection: RangeSelection) => {
  return escapableInlineFormats.some((format) => selection.hasFormat(format));
};

const metaOrCtrl = (meta: boolean, ctrl: boolean) => {
  return IS_MAC ? meta : ctrl;
};

export type Shortcut = {
  test: (e: KeyboardEvent) => boolean;
  handler: (editor: LexicalEditor) => void;
  label: string;
  priority: number;
};

export type KeyboardShortcutPluginProps = {
  shortcuts: Shortcut[];
};

function registerKeyboardShortcutsPlugin(
  editor: LexicalEditor,
  props: KeyboardShortcutPluginProps
) {
  const shortcuts = [...props.shortcuts].sort((a, b) => {
    return a.priority - b.priority;
  });
  const handler = (e: KeyboardEvent) => {
    for (const shortcut of shortcuts) {
      if (shortcut.test(e)) {
        e.preventDefault();
        e.stopPropagation();
        shortcut.handler(editor);
        return true;
      }
    }
    return false;
  };
  return mergeRegister(
    editor.registerCommand(KEY_DOWN_COMMAND, handler, COMMAND_PRIORITY_NORMAL),

    /** Allow ArrowRight to escape pesky inline formats. */
    editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      (e) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return false;
        }
        if (!$shouldEscapeRight(selection)) return false;
        if (!$isAtEndOfTextNode(selection)) return false;

        e.preventDefault();
        for (const format of escapableInlineFormats) {
          if (selection.hasFormat(format)) selection.toggleFormat(format);
        }
        return true;
      },
      COMMAND_PRIORITY_HIGH
    )
  );
}

export function keyboardShortcutsPlugin(props: KeyboardShortcutPluginProps) {
  return (editor: LexicalEditor) =>
    registerKeyboardShortcutsPlugin(editor, props);
}

export const DefaultShortcuts: Shortcut[] = [
  {
    label: META_OR_CTRL + '+shift+x',
    test: (e) => {
      return (
        e.code === 'KeyX' && e.shiftKey && metaOrCtrl(e.metaKey, e.ctrlKey)
      );
    },
    handler: (editor) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'strikethrough');
    },
    priority: 0,
  },
  {
    label: META_OR_CTRL + 'e',
    test: (e) => {
      return e.code === 'KeyE' && metaOrCtrl(e.metaKey, e.ctrlKey);
    },
    handler: (editor) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'code');
    },
    priority: 0,
  },
  {
    label: META_OR_CTRL + '+shift+h',
    test: (e) => {
      return e.code === 'KeyH' && metaOrCtrl(e.metaKey, e.ctrlKey);
    },
    handler: (editor) => {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'highlight');
    },
    priority: 0,
  },
];
