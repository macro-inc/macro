import { mergeRegister } from '@lexical/utils';
import {
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import type { LexicalWrapper } from '../../context/LexicalWrapperContext';
import {
  INSERT_LINK_COMMAND,
  linksPlugin,
  UNLINK_COMMAND,
  UPDATE_LINK_COMMAND,
  UPDATE_LINK_URL_COMMAND,
} from '../../plugins/links/linksPlugin';
import type { LinkMenuHost } from './link';

/** Preserve Source commands, priorities and plugin-manager lifetime ownership. */
export function createLexicalLinkMenuHost(
  wrapper: LexicalWrapper
): LinkMenuHost {
  const { editor, plugins, isInteractable } = wrapper;
  return {
    isEditable: () => editor.isEditable(),
    isInteractable: () => isInteractable(),
    root: () => editor.getRootElement(),
    focus: () => editor.focus(),
    registerMenu(callbacks, autoLinkMatchMode) {
      // PluginManager retains this registration and releases it with the wrapper,
      // matching the original component's plugins.use ownership.
      plugins.use(
        linksPlugin({
          onHoverLink: callbacks.hover,
          onClickLink: callbacks.click,
          onCreateLink: callbacks.create,
          autoLinkMatchMode,
        })
      );
    },
    registerKeys(callbacks) {
      return mergeRegister(
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          callbacks.escape,
          COMMAND_PRIORITY_HIGH
        ),
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          callbacks.enter,
          COMMAND_PRIORITY_CRITICAL
        )
      );
    },
    insert(url, label) {
      editor.dispatchCommand(INSERT_LINK_COMMAND, { url, linkText: label });
    },
    update(url, label) {
      editor.dispatchCommand(UPDATE_LINK_COMMAND, { url, linkText: label });
    },
    updateUrl(url) {
      editor.dispatchCommand(UPDATE_LINK_URL_COMMAND, url);
    },
    unlink() {
      editor.dispatchCommand(UNLINK_COMMAND, undefined);
    },
  };
}
