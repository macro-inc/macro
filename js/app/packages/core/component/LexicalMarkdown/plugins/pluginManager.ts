import { isInBlock } from '@core/block';
import { blockLoroManagerSignal } from '@core/signal/load';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerList } from '@lexical/list';
import { registerMarkdownShortcuts } from '@lexical/markdown';
import { registerPlainText } from '@lexical/plain-text';
import { registerRichText } from '@lexical/rich-text';
import {
  ALL_TRANSFORMERS,
  type EditorType,
  RegisteredNodesByType,
} from '@lexical-core';
import type { EditorState, LexicalEditor, UpdateListener } from 'lexical';
import type { Setter } from 'solid-js';
import { registerLoroHistory } from '../collaboration/undo';
import { bindStateAs } from '../utils';
import { checklistPlugin } from './checklist/';
import { customDeletePlugin } from './custom-delete';

/**
 * Create a binding between a LexicalEditor and the ability to register plugins
 * without having to manually track clean up functions.
 */
export function createPluginManager(editor: LexicalEditor, type: EditorType) {
  const cleanupFunctions: Array<() => void> = [];

  const pluginManager = {
    history(timeGap = 400) {
      const loroManager = isInBlock() ? blockLoroManagerSignal.get() : null;
      if (type === 'markdown-sync' && loroManager) {
        cleanupFunctions.push(
          registerLoroHistory(editor, loroManager.getDoc(), timeGap)
        );
      } else {
        cleanupFunctions.push(
          registerHistory(editor, createEmptyHistoryState(), timeGap)
        );
      }

      return pluginManager;
    },

    state<T extends EditorState | string>(
      setter: Setter<T>,
      mode?: 'json' | 'plain' | 'markdown' | 'markdown-internal'
    ) {
      cleanupFunctions.push(bindStateAs(editor, setter, mode));
      return pluginManager;
    },

    list() {
      cleanupFunctions.push(registerList(editor));
      cleanupFunctions.push(checklistPlugin()(editor));
      return pluginManager;
    },

    plainText() {
      cleanupFunctions.push(registerPlainText(editor));
      return pluginManager;
    },

    markdownShortcuts() {
      // Not all editor flavors support all nodes. Filter the available markdown shortcuts
      // to only those with all dependencies available.
      const transformers = ALL_TRANSFORMERS.filter((transformer) => {
        if (
          transformer.type === 'element' ||
          transformer.type === 'multiline-element'
        ) {
          const deps = transformer.dependencies;
          return deps.every((dep) => RegisteredNodesByType[type].includes(dep));
        }
        return true;
      });
      cleanupFunctions.push(registerMarkdownShortcuts(editor, transformers));
      return pluginManager;
    },

    richText() {
      cleanupFunctions.push(registerRichText(editor));
      return pluginManager;
    },

    delete() {
      cleanupFunctions.push(customDeletePlugin()(editor));
      return pluginManager;
    },

    use(pluginFn: (editor: LexicalEditor) => () => void) {
      const cleanup = pluginFn(editor);
      cleanupFunctions.push(cleanup);
      return pluginManager;
    },

    cleanup() {
      cleanupFunctions.forEach((cleanup) => {
        cleanup();
      });
      cleanupFunctions.length = 0;
    },

    onUpdate(callback: UpdateListener) {
      cleanupFunctions.push(editor.registerUpdateListener(callback));
    },
  };
  return pluginManager;
}

export type PluginManager = ReturnType<typeof createPluginManager>;
