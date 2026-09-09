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
import type { AnyLexicalExtensionArgument, NodeKey } from 'lexical';
import {
  defineExtension,
  type EditorThemeClasses,
  type LexicalEditor,
} from 'lexical';
import { createContext } from 'solid-js';
import type { Store } from 'solid-js/store';
import { pluginExtension } from '../extensions/pluginExtension';
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
  skipPreviewFetch?: boolean;
  /** Additional behavior composed into the editor's extension graph. */
  extensions?:
    | AnyLexicalExtensionArgument[]
    | ((wrapper: LexicalWrapper) => AnyLexicalExtensionArgument[]);
};

export type LexicalWrapperBase = {
  type: EditorType;
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

/** Wrapper retained for editor surfaces that have not migrated to extensions. */
export type LegacyLexicalWrapper = LexicalWrapper & {
  plugins: PluginManager;
};

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
  skipPreviewFetch,
  extensions,
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
  let disposeEditor = () => {};
  const wrapper: LexicalWrapper = {
    editor: undefined as unknown as LexicalEditor,
    cleanup: () => disposeEditor(),
    type,
    isInteractable,
    mapping,
    skipPreviewFetch,
  };
  const configuredExtensions =
    typeof extensions === 'function' ? extensions(wrapper) : (extensions ?? []);
  const editorWithDispose = buildEditorFromExtensions(
    defineExtension({
      name: '@macro-inc/lexical/editor-config',
      theme: theme ?? baseTheme,
      namespace: namespace + '_' + _id,
      nodes: () => [...nodes, ...replacements],
      onError: console.error,
      register: (editor) => {
        wrapper.editor = editor;
        return () => {};
      },
    }),
    pluginExtension('insert-text', insertTextPlugin()),
    pluginExtension('node-transform', nodeTransformPlugin()),
    ...(mapping
      ? [
          pluginExtension(
            'node-id',
            nodeIdPlugin({
              nodes: SupportedNodeTypes,
              idLength: 8,
              mappings: mapping,
            })
          ),
        ]
      : []),
    ...configuredExtensions
  );
  disposeEditor = editorWithDispose.dispose;
  wrapper.editor = editorWithDispose;

  return wrapper;
}

/**
 * Compatibility constructor for editor surfaces that still register through
 * PluginManager. New editor configurations should use `extensions` instead.
 */
export function createLegacyLexicalWrapper(
  props: LexicalWrapperProps & { withIds: true }
): LexicalWrapperWithMapping & { plugins: PluginManager };
export function createLegacyLexicalWrapper(
  props: LexicalWrapperProps & { withIds?: false | undefined }
): LexicalWrapperBase & { plugins: PluginManager };
export function createLegacyLexicalWrapper(
  props: LexicalWrapperProps
): LegacyLexicalWrapper {
  let plugins!: PluginManager;
  const legacyManagerExtension = pluginExtension(
    'legacy-plugin-manager',
    (editor) => {
      plugins = createPluginManager(editor, props.type);
      return plugins.cleanup;
    }
  );
  const configuredExtensions = props.extensions;
  const extensions = (wrapper: LexicalWrapper) => [
    legacyManagerExtension,
    ...(typeof configuredExtensions === 'function'
      ? configuredExtensions(wrapper)
      : (configuredExtensions ?? [])),
  ];
  const wrapper = props.withIds
    ? createLexicalWrapper({ ...props, withIds: true, extensions })
    : createLexicalWrapper({ ...props, withIds: false, extensions });
  return Object.assign(wrapper, { plugins });
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
