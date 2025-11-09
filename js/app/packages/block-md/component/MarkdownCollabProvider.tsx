import { markdownBlockErrorSignal } from '@block-md/signal/error';
import { createAwareness } from '@core/collab/awareness';
import { createSyncEngine } from '@core/collab/engine';
import type { LoroManager } from '@core/collab/manager';
import {
  $convertLexicalSelectionToCursors,
  $createSelectionFromPeerAwareness,
} from '@core/component/LexicalMarkdown/collaboration/cursor';
import {
  type LexicalSelectionAwareness,
  lexicalSelectionCodec,
} from '@core/component/LexicalMarkdown/collaboration/LexicalAwareness';
import { $reconcileLexicalState } from '@core/component/LexicalMarkdown/collaboration/reconcile';
import { useRemoteCursors } from '@core/component/LexicalMarkdown/collaboration/remote-cursor';
import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import type { PluginManager } from '@core/component/LexicalMarkdown/plugins';
import {
  initializeEditorEmpty,
  initializeEditorWithVersionedState,
  isStateEmpty,
  loroSyncState,
} from '@core/component/LexicalMarkdown/utils';
import { ScopedPortal } from '@core/component/ScopedPortal';
import {
  blockLoroManagerSignal,
  blockSourceSignal,
  blockSyncSourceSignal,
} from '@core/signal/load';
import { useCanComment, useCanEdit } from '@core/signal/permissions';
import { isSourceSyncService } from '@core/util/source';
import {
  $isCodeHighlightNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code';
import { mergeRegister } from '@lexical/utils';
import {
  $isCustomCodeNode,
  $updateAllNodeIds,
  COLLABORATION_TAG,
  CustomCodeNode,
  type NodeIdMappings,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from '@lexical-core';
import { useUserId } from '@service-gql/client';
import type { NodeKey, UpdateListenerPayload } from 'lexical';
import {
  $addUpdateTag,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  type EditorState,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  type Setter,
} from 'solid-js';
import { untrack } from 'solid-js/web';
import { CollabStatus } from './CollabStatus';

type MutatedNodes = UpdateListenerPayload['mutatedNodes'];

export type MarkdownCollabProviderProps = {
  editor: LexicalEditor;
  pluginManager: PluginManager;
  editorContainerRef: HTMLDivElement;
  highlighLayerRef: HTMLDivElement;
  mappings: NodeIdMappings;
  editorFocus: Accessor<boolean>;
  setEditorReady: Setter<boolean>;
  setEditorError: Setter<MarkdownEditorErrors | null>;
};

export const FROM_LORO_TAG = 'from-loro';
export const CODE_HIGHLIGHT_IDS_TAG = 'code-highlight-ids-tag';

export const FORCE_SYNC_COMMAND = createCommand<void>('FORCE_SYNC_COMMAND');

export function MarkdownCollabProvider(props: MarkdownCollabProviderProps) {
  const [didFirstSync, setDidFirstSync] = createSignal(false);
  const docSource = blockSourceSignal.get;
  const loroManager = blockLoroManagerSignal.get;
  const syncSource = blockSyncSourceSignal.get;
  const userId = useUserId();
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const [editorError] = markdownBlockErrorSignal;

  if (!loroManager() || !syncSource()) return null;

  const awareness = createAwareness(
    loroManager()!.getPeerIdStr(),
    userId(),
    lexicalSelectionCodec,
    {
      timeout: 5_000,
    }
  );

  const syncEngine = createSyncEngine(
    loroManager()!,
    awareness,
    syncSource()!,
    {
      syncFromLoro: (state) =>
        syncStateToLexical(state as unknown as SerializedEditorState),
    },
    !(canEdit() || canComment())
  );

  const { refreshRemoteCursors, RemoteCursorsOverlay } = useRemoteCursors({
    loroManager: loroManager()!,
    mapping: props.mappings,
    editor: props.editor,
    awareness: awareness,
  });

  /**
   * Responsible for syncing incoming state from the loro manager to the lexical editor
   *
   * @param state - The state to sync to the lexical editor
   */
  function syncStateToLexical(state: SerializedEditorState) {
    if (!syncEngine.isRunning()) {
      console.warn('tried to sync state to lexical, but engine is not running');
      return;
    }
    const hadFocus = props.editorFocus();
    let manager = loroManager();
    if (!manager) {
      console.error(
        'registering sync state to lexical, but no manager -- this should never happen'
      );
      return;
    }

    props.editor.update(
      () => {
        $addUpdateTag(SKIP_DOM_SELECTION_TAG);
        $addUpdateTag(COLLABORATION_TAG);

        let selectionFormat = 0;
        const selection = $getSelection();
        if ($isRangeSelection(selection)) {
          selectionFormat = selection.format;
        }

        // Clear the selection first
        $setSelection(null);

        // Reconcile the new lexical state with the current one
        // This uses the stable nodeIds to determine which nodes have changed
        // and need to be updated.
        $reconcileLexicalState(
          props.editor.getEditorState().toJSON(),
          state,
          props.mappings,
          () => loroManager()!.getPeerIdStr()
        );

        // Queue microtask after this `editor.update` to ensure that all the nodeIds are updated
        queueMicrotask(() => {
          props.editor.update(() => {
            $updateAllNodeIds(props.mappings);
            // If we import a remote update, it's possible that the update
            // has shifted out own selection / cursor. We need to re-position our local
            // cursor based on the new lexical state using the stable LoroCursor.
            let localAwareness = awareness.local();
            if (localAwareness.selection) {
              if (!hadFocus) {
                $addUpdateTag(SKIP_DOM_SELECTION_TAG);
              }
              $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
              $createSelectionFromPeerAwareness(
                manager,
                props.editor,
                localAwareness.selection,
                props.mappings,
                selectionFormat
              );
            }
          });
        });
      },
      {
        discrete: true,
        tag: FROM_LORO_TAG,
        onUpdate: () => {
          refreshRemoteCursors();
        },
      }
    );
  }

  /** Convert the current local selection to a loro cursor */
  function localCursorUpdate():
    | { awareness: LexicalSelectionAwareness; format: number }
    | undefined {
    const loroManager_ = loroManager();

    if (!loroManager_) {
      console.error(
        'tried to convert selection to cursor, but no loro manager'
      );
      return;
    }

    props.editor.read(() => {
      const selection = $getSelection();

      if (!selection) {
        return;
      }

      // Convert the current selection to a set of LoroCursors
      const cursors = $convertLexicalSelectionToCursors(
        loroManager_,
        props.mappings,
        selection
      );

      if (!cursors) {
        console.warn(
          'MarkdownCollabProvider: Failed to convert selection to cursors'
        );
        return;
      }

      let localSelection: LexicalSelectionAwareness = {
        anchor: cursors.anchor,
        focus: cursors.focus,
      };

      let format = $isRangeSelection(selection) ? selection.format : 0;

      // Update the local awareness with the new cursors
      // If a engine is configured, it will sync the local awareness to other peers
      awareness.updateLocalAwareness(localSelection);
      return {
        awareness,
        format,
      };
    });
  }

  /** Handle the cursor state after successful sync from Lexical->Loro */
  function $afterSyncCursorUpdate(manager: LoroManager) {
    // Update the local cursor after the state has been synced
    let newLocalSelection = localCursorUpdate();

    if (newLocalSelection) {
      $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
      $createSelectionFromPeerAwareness(
        manager,
        props.editor,
        newLocalSelection.awareness,
        props.mappings,
        newLocalSelection.format
      );
    }

    // Refresh / re-render the remote cursors
    // to put them in the correct positions
    refreshRemoteCursors();
  }

  /**
   * Enforce an extra nodeId pass over the state if the incoming mutations are code syntax highlights. When a
   * line of code changes, Lexical:
   * 1) Creates or appends to the current text node children of the code node
   * 2) Runs the code node line-by-line through PrismJS to get tokens
   * 3) Upgrades to code highlight nodes using the new tokens with the skipTransforms flag set to true - so our
   *    id-assigning node transform does not run on new highlights. This pass enforces ids before making it to Loro.
   * @param mutatedNodes
   * @returns True if code highlight mutations were found and a node id update was manually triggered.
   */
  function codeNodeUpdateHandler(mutatedNodes: MutatedNodes): boolean {
    if (!mutatedNodes || mutatedNodes.size === 0) {
      return false;
    }

    const nodeKeysToUpdate = new Set<NodeKey>();
    for (const [klass, mutations] of mutatedNodes) {
      if (
        klass === CodeHighlightNode ||
        klass === CodeNode ||
        klass === CustomCodeNode
      ) {
        for (const [nodeKey, mutationType] of mutations) {
          if (mutationType !== 'destroyed') {
            nodeKeysToUpdate.add(nodeKey);
          }
        }
      }
    }

    if (nodeKeysToUpdate.size > 0) {
      props.editor.update(
        () => {
          const parentNodes = new Set<CodeNode | CustomCodeNode>();
          for (const key of nodeKeysToUpdate) {
            const node = $getNodeByKey(key);
            if ($isCodeNode(node) || $isCustomCodeNode(node)) {
              parentNodes.add(node);
              continue;
            }
            if ($isCodeHighlightNode(node)) {
              const parent = node.getParent();
              if ($isCodeNode(parent) || $isCustomCodeNode(parent)) {
                parentNodes.add(parent);
              }
            }
          }
          for (const node of parentNodes) {
            $updateAllNodeIds(props.mappings, node);
          }
        },
        {
          discrete: true,
          tag: CODE_HIGHLIGHT_IDS_TAG,
          onUpdate: async () => {
            const stateToSync = loroSyncState(props.editor.getEditorState());
            await syncEngine.syncStateToLoro(stateToSync as any);
            loroManager() && $afterSyncCursorUpdate(loroManager()!);
          },
        }
      );
    }
    return nodeKeysToUpdate.size > 0;
  }

  async function syncLexicalToLoro(
    state: EditorState,
    mutatedNodes: MutatedNodes,
    tags: Set<string>
  ) {
    if (!syncEngine.isRunning()) {
      console.warn(
        'tried to sync lexical state to loro, but engine is not running'
      );
      return;
    }
    const manager = loroManager();
    if (!manager) {
      console.error(
        'registering sync state to lexical, but no manager -- this should never happen'
      );
      return;
    }
    // State updates tagged with 'FROM_LORO' are from the syncToLexical function
    // and should not be synced to the loroManager. This would cause an infinite loop.
    if (
      tags.has(FROM_LORO_TAG) ||
      tags.has(COLLABORATION_TAG) ||
      tags.has(CODE_HIGHLIGHT_IDS_TAG)
    ) {
      return false;
    }

    if (!didFirstSync()) {
      return false;
    }

    // Only sync state if there are changes
    if (mutatedNodes && mutatedNodes.size > 0) {
      // Do not try to send any state to Loro until code highlight ids have resolved.
      if (codeNodeUpdateHandler(mutatedNodes)) {
        return false;
      }

      // Clean the state to remove any state properties that should not be synced
      const stateToSync = loroSyncState(state);
      await syncEngine.syncStateToLoro(stateToSync as any);
    }

    $afterSyncCursorUpdate(manager);
  }

  function lexicalStateSyncPlugin() {
    return mergeRegister(
      props.editor.registerUpdateListener(
        ({ editorState, tags, mutatedNodes }) => {
          syncLexicalToLoro(editorState, mutatedNodes, tags);
          return false;
        }
      ),
      props.editor.registerCommand(
        FORCE_SYNC_COMMAND,
        () => {
          const stateToSync = loroSyncState(props.editor.getEditorState());
          syncEngine.syncStateToLoro(stateToSync as any);
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
  }

  function startSync() {
    syncEngine.start();
    props.pluginManager.use(lexicalStateSyncPlugin);
  }

  /** Initializes the loroManager and starts the sync engine */
  createEffect(
    on(
      () => loroManager()?.isInitialized() ?? false,
      (isInitialized) => {
        if (!isInitialized) {
          console.warn('loro manager not initialized');
          return;
        }

        const source = docSource();
        if (!source) return;
        if (isSourceSyncService(source)) {
          const manager = untrack(loroManager);
          if (!manager) {
            console.error(
              'registering sync state to lexical, but no manager -- this should never happen'
            );
            return;
          }
          // Get the current state from the loroManager
          // At this point, the loroManager should be initialized and should
          // have the initial state from the sync service
          const state = untrack(manager.state);

          //TODO: some more descriptive user facing error should be displayed here
          if (!state) {
            console.error('could not initialize editor from sync service');
            return;
          }

          // Indicate that we have completed the first sync
          setDidFirstSync(true);

          // Initialize the editor with the initial state from the sync service
          if (isStateEmpty(state.state as unknown as SerializedEditorState)) {
            initializeEditorEmpty(props.editor);
          } else {
            const initError = initializeEditorWithVersionedState(
              props.editor,
              state.state as unknown as SerializedEditorState,
              loroManager()!.getPeerIdStr
            );
            if (initError !== null) {
              props.setEditorError(initError);
              return;
            }
          }

          // Start the sync engine
          startSync();
          props.setEditorReady(true);
        }
      }
    )
  );

  createEffect(
    on(editorError, () => {
      if (editorError() !== null) {
        syncEngine.stop();
      }
    })
  );

  onCleanup(() => {
    syncEngine.stop();
  });

  return (
    <>
      <RemoteCursorsOverlay
        anchorElem={props.editorContainerRef}
        highlightLayer={props.highlighLayerRef}
      />
      <ScopedPortal scope="block">
        <div class="absolute bottom-4 right-4 w-fit h-fit">
          <CollabStatus />
        </div>
      </ScopedPortal>
    </>
  );
}
