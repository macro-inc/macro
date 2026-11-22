import {
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import type { LexicalWrapper } from '../../context/LexicalWrapperContext';
import {
  autoRegister,
  type EnhancedSelection,
  NODE_TRANSFORM,
  popupPlugin,
  registerRootEventListener,
  TRY_INSERT_LINK_COMMAND,
  UNLINK_COMMAND,
} from '../../plugins';
import type { FormatMenuHost } from './format';

/** Preserve Source registrations and dispatch through the real Source wrapper. */
export function createLexicalFormatMenuHost(
  wrapper: LexicalWrapper
): FormatMenuHost {
  const { editor, plugins } = wrapper;
  return {
    selection: () => wrapper.selection,
    isInteractable: wrapper.isInteractable,
    root: () => editor.getRootElement(),
    focus: () => editor.focus(),
    formatText(format) {
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    },
    formatBlock(format) {
      editor.dispatchCommand(NODE_TRANSFORM, format);
    },
    requestLink() {
      editor.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);
    },
    unlink() {
      editor.dispatchCommand(UNLINK_COMMAND, undefined);
    },
    registerPopup(callbacks) {
      plugins.use(
        popupPlugin({
          setIsPopupVisible: callbacks.visible,
          setSelection: (value: EnhancedSelection | null) =>
            callbacks.selection(
              value?.type === 'range' ? value.domSelection : undefined
            ),
        })
      );
    },
    registerListeners(callbacks) {
      autoRegister(
        registerRootEventListener(editor, 'focusout', ({ relatedTarget }) => {
          callbacks.focusOut(relatedTarget);
        }),
        editor.registerCommand(
          NODE_TRANSFORM,
          callbacks.transform,
          COMMAND_PRIORITY_HIGH
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          callbacks.escape,
          COMMAND_PRIORITY_HIGH
        )
      );
    },
  };
}
