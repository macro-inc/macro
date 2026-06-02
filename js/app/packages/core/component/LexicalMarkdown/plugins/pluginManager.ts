import type { LoroManager } from '@core/collab/manager';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { registerList } from '@lexical/list';
import { CODE } from '@lexical/markdown';
import { registerPlainText } from '@lexical/plain-text';
import { registerRichText } from '@lexical/rich-text';
import { ALL_TRANSFORMERS, type EditorType } from '@lexical-core';
import { HR } from '@lexical-core/transformers/transformers';
import type { EditorState, LexicalEditor, UpdateListener } from 'lexical';
import {
  type Accessor,
  type AccessorArray,
  createEffect,
  createRoot,
  on,
  type Setter,
} from 'solid-js';
import { registerLoroHistory } from '../collaboration/undo';
import { bindStateAs } from '../utils';
import { checklistPlugin } from './checklist/';
import { customDeletePlugin } from './custom-delete';
import { markdownShortcutsPlugin } from './markdown-shortcuts';

type PluginFunction = (editor: LexicalEditor) => () => void;

/**
 * Create a binding between a LexicalEditor and the ability to register plugins
 * without having to manually track clean up functions.
 */
export function createPluginManager(editor: LexicalEditor, type: EditorType) {
  const cleanupFunctions: Array<() => void> = [];

  const pluginManager = {
    history(timeGap = 400, loroManager?: LoroManager) {
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
      cleanupFunctions.push(
        markdownShortcutsPlugin({
          transformers: ALL_TRANSFORMERS,
          triggerOnEnterTransformers: [HR, CODE],
        })(editor)
      );
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

    use(pluginFn: PluginFunction) {
      const cleanup = pluginFn(editor);
      cleanupFunctions.push(cleanup);
      return pluginManager;
    },

    useReactive<T>(
      deps: AccessorArray<T> | Accessor<T>,
      pluginAccessor: Accessor<PluginFunction | undefined>
    ) {
      let disposeRoot!: () => void;
      let lastCleanup = pluginAccessor()?.(editor);
      createRoot((dispose) => {
        disposeRoot = dispose;
        createEffect(
          on(
            deps,
            () => {
              lastCleanup?.();
              lastCleanup = pluginAccessor()?.(editor);
            },
            { defer: true }
          )
        );
      });
      cleanupFunctions.push(() => {
        lastCleanup?.();
        disposeRoot();
      });
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
