/**
 * @file Wrap the Lexical Editor in some helpful utilities.
 */
import {
  type EditorType,
  type NodeIdMappings,
  NodeReplacements,
  nodeIdPlugin,
  RegisteredNodesByType,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import type { NodeKey } from 'lexical';
import { createEditor, type EditorThemeClasses } from 'lexical';
import { getOwner } from 'solid-js';
import { initializeLexical } from '../init';
import {
  createPluginManager,
  insertTextPlugin,
  nodeTransformPlugin,
} from '../plugins';
import { theme as baseTheme } from '../theme';
import type {
  LexicalWrapper,
  LexicalWrapperBase,
  LexicalWrapperWithMapping,
} from './LexicalWrapperContext';

type LexicalWrapperProps = {
  type: EditorType;
  namespace: string;
  isInteractable: () => boolean;
  withIds?: boolean;
  theme?: EditorThemeClasses;
};

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
}: LexicalWrapperProps): LexicalWrapper {
  initializeLexical();
  const owner = getOwner();
  _id++;

  const nodes = RegisteredNodesByType[type];
  const replacements = NodeReplacements.filter((replacement) => {
    if (!nodes.includes(replacement.replace)) return false;
    if (replacement.withKlass && !nodes.includes(replacement.withKlass))
      return false;

    return true;
  });

  const editor = createEditor({
    theme: theme ?? baseTheme,
    namespace: namespace + '_' + _id,
    nodes: [...nodes, ...replacements],
    onError: console.error,
  });

  // Only constant editor categories reach telemetry; never emit namespaces,
  // which can include document ids or user-supplied labels.
  const surface =
    namespace === 'agent-input'
      ? 'agent-composer'
      : namespace === 'channel-input-markdown'
        ? 'channel-composer'
        : type;
  const releaseTypingRoot = editor.registerRootListener((root, previous) => {
    previous?.removeAttribute('data-input-surface');
    root?.setAttribute('data-input-surface', surface);
  });
  const plugins = createPluginManager(editor, type);

  let mapping: NodeIdMappings | undefined;

  // Default plugins here.
  plugins.use(insertTextPlugin());
  plugins.use(nodeTransformPlugin());

  if (withIds) {
    mapping = createMapping();
    plugins.use(
      nodeIdPlugin({
        nodes: SupportedNodeTypes,
        idLength: 8,
        mappings: mapping,
      })
    );
  }

  const cleanup = () => {
    editor.getRootElement()?.removeAttribute('data-input-surface');
    releaseTypingRoot();
    plugins.cleanup();
  };

  return {
    plugins,
    editor,
    cleanup,
    owner,
    type,
    isInteractable,
    mapping,
  };
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
