import { $unwrapNode, mergeRegister } from '@lexical/utils';
import {
  $createCompletionNode,
  $isCompletionNode,
  CompletionNode,
  SupportedNodeTypes,
} from '@lexical-core';
import {
  $addUpdateTag,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $parseSerializedNode,
  $setSelection,
  type BaseSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  createEditor,
  KEY_ENTER_COMMAND,
  KEY_SPACE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { createEffect, createSignal, on, type Setter } from 'solid-js';
import { theme } from '../../theme';
import { $traverseNodes, setEditorStateFromMarkdown } from '../../utils';

export {
  $createCompletionNode,
  $isCompletionNode,
  COMPLETION_NODE_TYPE,
  CompletionNode,
} from '@lexical-core';

import type { createBlockSignal } from '@core/block';
import type { SetStoreFunction } from 'solid-js/store';
import { GenerateAccessory } from '../../component/accessory/GenerateAccessory';
import {
  type AccessoryStore,
  FORCE_REFRESH_ACCESSORIES_COMMAND,
  nodeAccessoryPlugin,
} from '../node-accessory/nodeAccessoryPlugin';
import { getContext } from './context';

export type Completion = {
  // location content is being generated at
  selection: BaseSelection;
  // parent element of the completion node
  parentElement: HTMLElement | null;
  // content
  text: string;
  // done??!?
  doneGenerating: boolean;
};

// ai generated content
export type CompletionSignal = ReturnType<
  typeof createSignal<Completion | undefined>
>;
// where is this open
export type GenerateMenuOpen = ReturnType<
  typeof createSignal<boolean | undefined>
>;
// done generating and waiting
export type BooleanSignal = ReturnType<typeof createBlockSignal<boolean>>;

export const IGNORE_COMPLETION_TYPES = ['inline-search'];
export const MAKE_COMPLETION: LexicalCommand<Completion> =
  createCommand('MAKE_COMPLETION');
export const ACCEPT_COMPLETION: LexicalCommand<void> =
  createCommand('ACCEPT_COMPLETION');
export const REJECT_COMPLETION: LexicalCommand<void> =
  createCommand('REJECT_COMPLETION');
export const SET_CONTEXT: LexicalCommand<RangeSelection> =
  createCommand('SET_CONTEXT');

export interface MenuArgs {
  context: string;
}

export type GeneratePluginArgs = {
  // called when the selection changes
  completionSignal: CompletionSignal;
  isGeneratingSignal: BooleanSignal;
  generatedAndWaitingSignal: BooleanSignal;
  menuSignal: GenerateMenuOpen;
  setContext: Setter<string | undefined>;

  // for node accessory plugin
  accessories: AccessoryStore;
  setAccessories: SetStoreFunction<AccessoryStore>;
};

function registerGeneratePlugin(
  editor: LexicalEditor,
  args: GeneratePluginArgs
) {
  const [menuOpen, setMenuOpen] = args.menuSignal;
  const [completionSignal, setCompletionSignal] = args.completionSignal;
  const [generatedAndWaiting, setGeneratedAndWaiting] =
    args.generatedAndWaitingSignal;
  const [isGenerating, setIsGenerating] = args.isGeneratingSignal;

  const [isNewGeneration, setIsNewGeneration] = createSignal<boolean>(true);

  const clearGenerationState = () => {
    setMenuOpen(false);
    setIsGenerating(false);
    setGeneratedAndWaiting(false);
    setIsNewGeneration(true);
  };

  const generationEditor = createEditor({
    theme,
    namespace: 'completion-renderer',
    editable: false,
    nodes: SupportedNodeTypes,
  });

  createEffect(() => {
    const completion = completionSignal();
    if (completion && isGenerating()) {
      editor.dispatchCommand(MAKE_COMPLETION, completion);
    }
  });

  createEffect(
    on(generatedAndWaiting, () => {
      if (generatedAndWaiting() && !completionSignal()?.text) {
        editor.dispatchCommand(REJECT_COMPLETION, undefined);
      }
    })
  );

  createEffect(() => {
    if (menuOpen()) {
      editor.read(() => {
        const root = $getRoot();
        for (const node of root.getChildren()) {
          if ($isParagraphNode(node)) {
            const dom = editor.getElementByKey(node.getKey());
            if (dom) {
              dom.classList.remove('show-placeholder');
            }
          }
        }
      });
    }
  });

  return mergeRegister(
    // clear active completion on update
    editor.registerMutationListener(CompletionNode, (nodes) => {
      editor.update(
        () => {
          const updates = nodes
            .entries()
            .toArray()
            .filter(([_key, mutation]) => mutation === 'updated');
          for (const [key, _mutation] of updates) {
            const node = $getNodeByKey(key);
            if (node) node.remove();
          }
        },
        { tag: 'history-merge' }
      );
    }),
    editor.registerCommand(
      SET_CONTEXT,
      (selection) => {
        const context = getContext(editor, generationEditor, selection);
        if (context) args.setContext(context);
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    editor.registerCommand(
      KEY_SPACE_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!selection || !$isValidCompletionSelection(selection)) {
          return true;
        }
        let parentElement: HTMLElement | null = null;

        if ($isRangeSelection(selection)) {
          const parentNode = selection.anchor.getNode().getTopLevelElement();
          if (parentNode) {
            parentElement = editor.getElementByKey(parentNode.getKey());
          }
        }

        setCompletionSignal({
          selection,
          text: '',
          doneGenerating: false,
          parentElement,
        });
        setMenuOpen(true);
        // @ts-ignore -- its a range selection (ong)
        editor.dispatchCommand(SET_CONTEXT, selection);
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      KEY_TAB_COMMAND,
      (event) => {
        if (generatedAndWaiting()) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (generatedAndWaiting()) {
          if (event) {
            event.preventDefault();
          }
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    editor.registerCommand(
      MAKE_COMPLETION,
      (completion: Completion) => {
        $destroyActiveCompletions();
        const selectedNode = $getNodeByKey(
          (completion.selection as RangeSelection).anchor.key
        );
        if (!selectedNode) return true;
        setEditorStateFromMarkdown(
          generationEditor,
          completion.text,
          'external'
        );
        const editorState = generationEditor.getEditorState();
        const completionNodes = editorState.toJSON().root.children;
        const _isNewGeneration = isNewGeneration();
        if (_isNewGeneration) {
          setIsNewGeneration(false);
        }
        editor.update(
          () => {
            // don't move selection as content is inserted
            $addUpdateTag('skip-dom-selection');
            const nodes = completionNodes.map((node) =>
              $parseSerializedNode(node)
            );
            const node = $createCompletionNode(nodes, true);
            selectedNode.insertBefore(node);
          },
          { tag: _isNewGeneration ? 'history-push' : 'history-merge' }
        );
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    ),
    // reject completion
    editor.registerCommand(
      REJECT_COMPLETION,
      () => {
        clearGenerationState();
        editor.update(
          () => {
            $destroyActiveCompletions();
            const completion = completionSignal();
            if (completion && completion.selection)
              $setSelection(completion.selection.clone());
            setCompletionSignal(undefined);
          },
          { tag: 'history-merge' }
        );
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    // accept completion
    editor.registerCommand(
      ACCEPT_COMPLETION,
      () => {
        clearGenerationState();
        const activeCompletion = $getActiveCompletion();
        if (activeCompletion) {
          editor.update(
            () => {
              const childKeys = activeCompletion
                .getChildren()
                .map((child) => child.getKey());
              $unwrapNode(activeCompletion);
              activeCompletion.remove();
              queueMicrotask(() => {
                editor.dispatchCommand(
                  FORCE_REFRESH_ACCESSORIES_COMMAND,
                  childKeys
                );
                editor.focus();
              });
            },
            { tag: 'history-merge', discrete: true }
          );
        }
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    (() => {
      if (editor.hasNode(CompletionNode)) {
        const codeAccessory = nodeAccessoryPlugin({
          klass: CompletionNode,
          store: args.accessories,
          setStore: args.setAccessories,
          component: ({ ref, key }) =>
            GenerateAccessory({
              floatRef: ref,
              editor,
              nodeKey: key,
              isGenerating,
            }),
        });
        return codeAccessory(editor);
      }
      return () => {};
    })()
  );
}

export function generatePlugin(args: GeneratePluginArgs) {
  return (editor: LexicalEditor) => registerGeneratePlugin(editor, args);
}

function $destroyActiveCompletions(): boolean {
  const root = $getRoot();
  let destroyed = false;
  $traverseNodes(root, (node) => {
    if ($isCompletionNode(node)) {
      node.remove();
      destroyed = true;
    }
  });
  return destroyed;
}

function $getActiveCompletion(): CompletionNode | undefined {
  const root = $getRoot();
  let completion;
  $traverseNodes(root, (node) => {
    if ($isCompletionNode(node)) completion = node;
  });
  return completion;
}

function $isValidCompletionSelection(selection: BaseSelection | null) {
  // only on range selection
  // only no text selected
  if ($isRangeSelection(selection) && selection.isCollapsed()) {
    const selectedNode = selection.anchor.getNode();
    // only empty paragraph node
    if (
      $isParagraphNode(selectedNode) &&
      selectedNode.getChildrenSize() === 0 &&
      $isRootNode(selectedNode.getParent())
    ) {
      return true;
    }
  }
  return false;
}
