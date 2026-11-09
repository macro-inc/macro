import { mergeRegister } from '@lexical/utils';
import { $isEquationNode, $isImageNode } from '@macro-inc/lexical-core';
import {
  $createNodeSelection,
  $getNodeByKey,
  $setSelection,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import type { DecoratorHost } from '../context/DecoratorHostContext';
import type { LexicalWrapper } from '../context/LexicalWrapperContext';
import {
  INSERT_EQUATION_COMMAND,
  katexPlugin,
  TRY_UPDATE_EQUATION_COMMAND,
  UPDATE_EQUATION_COMMAND,
} from '../plugins/katex/katexPlugin';
import {
  $upgradeDSSMediaUrl,
  ON_MEDIA_COMPONENT_MOUNT_COMMAND,
  UPDATE_MEDIA_SIZE_COMMAND,
  UPLOAD_MEDIA_FAILURE_COMMAND,
  UPLOAD_MEDIA_START_COMMAND,
  UPLOAD_MEDIA_SUCCESS_COMMAND,
} from '../plugins/media';
import { UPDATE_USER_DISPLAY_NAME_COMMAND } from '../plugins/mentions/mentionsPlugin';
import { removeNodeAndRestoreSelection } from '../plugins/shared/removeNodeAndRestoreSelection';

/** Retain the source calls and their transaction boundaries for the OFF host. */
export function createLexicalDecoratorHost(
  wrapper: LexicalWrapper | undefined
): DecoratorHost {
  const isSelected = (key: string) =>
    wrapper?.selection?.type === 'node' && wrapper.selection.nodeKeys.has(key);
  return {
    isSelected,
    isEditable: () => wrapper?.editor.isEditable() ?? false,
    isInteractable: () => wrapper?.isInteractable() ?? false,
    updateUserDisplayName(userId, displayName) {
      wrapper?.editor.dispatchCommand(UPDATE_USER_DISPLAY_NAME_COMMAND, {
        [userId]: displayName,
      });
    },
    equation: {
      requestEdit(key) {
        wrapper?.editor.dispatchCommand(TRY_UPDATE_EQUATION_COMMAND, key);
      },
      current(key) {
        const node = $getNodeByKey(key);
        return $isEquationNode(node)
          ? { equation: node.__equation, inline: node.__inline }
          : null;
      },
      element(key) {
        const node = $getNodeByKey(key);
        return node ? (wrapper?.editor.getElementByKey(key) ?? null) : null;
      },
      registerMenu(callbacks) {
        wrapper?.plugins.use(
          katexPlugin({
            onClickEquation: callbacks.edit,
            onCreateEquation: callbacks.create,
          })
        );
      },
      update(key, equation) {
        wrapper?.editor.dispatchCommand(UPDATE_EQUATION_COMMAND, {
          nodeKey: key,
          equation,
        });
      },
      insert(equation, inline) {
        wrapper?.editor.dispatchCommand(INSERT_EQUATION_COMMAND, {
          equation,
          inline,
        });
      },
      root: () => wrapper?.editor.getRootElement() ?? null,
      focus() {
        wrapper?.editor.focus();
      },
    },
    image: {
      select(key) {
        const editor = wrapper?.editor;
        if (!editor || !editor.isEditable() || isSelected(key)) return;
        editor.update(() => {
          const selection = $createNodeSelection();
          selection.add(key);
          $setSelection(selection);
        });
      },
      remove(key) {
        if (wrapper?.editor)
          removeNodeAndRestoreSelection(wrapper.editor, key, $isImageNode);
      },
      resize(key, width, height) {
        wrapper?.editor.dispatchCommand(UPDATE_MEDIA_SIZE_COMMAND, [
          key,
          { width, height },
          'image',
        ]);
      },
      persistScale(key, scale) {
        const editor = wrapper?.editor;
        if (!wrapper?.isInteractable() || !editor?.isEditable()) return;
        editor.update(() => {
          if (!editor.isEditable()) return;
          const node = $getNodeByKey(key);
          if (node && $isImageNode(node)) node.setScale(scale, false);
        });
      },
      readScale(key, fallback) {
        return wrapper?.editor.read(() => {
          const node = $getNodeByKey(key);
          return node && $isImageNode(node) ? node.getScale() : fallback;
        });
      },
      upgradeUrl(key, url) {
        wrapper?.editor.update(() => $upgradeDSSMediaUrl(key, url, 'image'), {
          discrete: true,
          tag: 'historic',
        });
      },
      subscribeUploads(key, callbacks) {
        const editor = wrapper?.editor;
        if (!editor) return () => {};
        return mergeRegister(
          editor.registerCommand(
            UPLOAD_MEDIA_START_COMMAND,
            ([target]) => {
              if (target !== key) return false;
              callbacks.start();
              return true;
            },
            COMMAND_PRIORITY_LOW
          ),
          editor.registerCommand(
            UPLOAD_MEDIA_SUCCESS_COMMAND,
            ([target]) => {
              if (target !== key) return false;
              callbacks.success();
              return true;
            },
            COMMAND_PRIORITY_LOW
          ),
          editor.registerCommand(
            UPLOAD_MEDIA_FAILURE_COMMAND,
            ([target]) => {
              if (target !== key) return false;
              callbacks.failure();
              return true;
            },
            COMMAND_PRIORITY_LOW
          )
        );
      },
      mounted(key) {
        wrapper?.editor.dispatchCommand(ON_MEDIA_COMPONENT_MOUNT_COMMAND, [
          key,
          'image',
        ]);
      },
    },
  };
}
