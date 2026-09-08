/**
 * @file Wrap the Lexical Editor in some helpful utilities.
 */
import { buildEditorFromExtensions } from '@lexical/extension';
import {
  type EditorType,
  type NodeIdMappings,
  NodeReplacements,
  nodeIdPlugin,
  RegisteredNodesByType,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import type { NodeKey } from 'lexical';
import {
  defineExtension,
  type EditorThemeClasses,
  type LexicalEditor,
} from 'lexical';
import { createContext } from 'solid-js';
import type { Store } from 'solid-js/store';
import { insertTextPlugin } from '../plugins/insert-text';
import { nodeTransformPlugin } from '../plugins/node-transform';
import {
  createPluginManager,
  type PluginManager,
} from '../plugins/pluginManager';
import type { SelectionData } from '../plugins/selection-data';
import { theme as baseTheme } from '../theme';

type LexicalWrapperProps = {
  type: EditorType;
  namespace: string;
  isInteractable: () => boolean;
  withIds?: boolean;
  theme?: EditorThemeClasses;
  /** Register editor behavior as part of the extension lifecycle. */
  configure?: (wrapper: LexicalWrapper) => void;
};

export type LexicalWrapperBase = {
  type: EditorType;
  plugins: PluginManager;
  editor: LexicalEditor;
  cleanup: () => void;
  isInteractable: () => boolean;
  selection?: Store<SelectionData>;
  /** When true, decorator components should skip backend fetches (e.g. preview API). */
  skipPreviewFetch?: boolean;
};

export type LexicalWrapperWithMapping = LexicalWrapperBase & {
  mapping: NodeIdMappings;
};

export type LexicalWrapper = LexicalWrapperBase | LexicalWrapperWithMapping;

export const LexicalWrapperContext = createContext<LexicalWrapper>();

// Simple increasing id to differentiate multiple editors on page.
let _id = 0;

/**
 * Create a Lexical wrapper with extra utilities for adding plugins and tracking
 * cleanup functions.
 * @param type The type of editor to create. The current options are 'markdown',
 *     'plain-text', 'chat', and 'markdown-sync' which are each configured to include
 *     and exclude node lists tailored to those use cases.
 * @param namespace A namespace hint for the editor - useful for debugging.
 * @param isInteractable A function that returns true if when the editor should be interactable.
 * @param withIds If true, the editor will have node ids and the wrapper will have a
 *     bi-directional durable nodeId <- -> ephemeral nodeKey mapping managed by the nodeId plugin.
 */

export function createLexicalWrapper(
  props: LexicalWrapperProps & { withIds: true }
): LexicalWrapperWithMapping;

export function createLexicalWrapper(
  props: LexicalWrapperProps & { withIds?: false | undefined }
): LexicalWrapperBase;

export function createLexicalWrapper({
  type,
  namespace,
  isInteractable,
  withIds,
  theme,
  configure,
}: LexicalWrapperProps): LexicalWrapper {
  _id++;

  const nodes = RegisteredNodesByType[type];
  const replacements = NodeReplacements.filter((replacement) => {
    if (!nodes.includes(replacement.replace)) return false;
    if (replacement.withKlass && !nodes.includes(replacement.withKlass))
      return false;

    return true;
  });

  const mapping = withIds ? createMapping() : undefined;
  let wrapper!: LexicalWrapper;
  let disposeEditor = () => {};
  const editorWithDispose = buildEditorFromExtensions(
    defineExtension({
      name: 'macro/editor',
      theme: theme ?? baseTheme,
      namespace: namespace + '_' + _id,
      nodes: () => [...nodes, ...replacements],
      onError: console.error,
      register: (editor) => {
        const plugins = createPluginManager(editor, type);
        wrapper = {
          plugins,
          editor,
          cleanup: () => disposeEditor(),
          type,
          isInteractable,
          mapping,
        };

        // Default plugins here.
        plugins.use(insertTextPlugin());
        plugins.use(nodeTransformPlugin());

        if (mapping) {
          plugins.use(
            nodeIdPlugin({
              nodes: SupportedNodeTypes,
              idLength: 8,
              mappings: mapping,
            })
          );
        }

        configure?.(wrapper);
        return plugins.cleanup;
      },
    })
  );
  disposeEditor = editorWithDispose.dispose;

  return wrapper;
}

export function isWrapperWithIds(
  wrapper: LexicalWrapper | undefined
): wrapper is LexicalWrapperWithMapping {
  return Boolean(
    wrapper && 'mapping' in wrapper && wrapper['mapping'] !== undefined
  );
}

function createMapping(): NodeIdMappings {
  const idToNodeKeyMap: Map<string, NodeKey> = new Map();
  const nodeKeyToIdMap: Map<NodeKey, string> = new Map();

  const nodeIdMappings: NodeIdMappings = {
    idToNodeKeyMap,
    nodeKeyToIdMap,
  };

  return nodeIdMappings;
}
