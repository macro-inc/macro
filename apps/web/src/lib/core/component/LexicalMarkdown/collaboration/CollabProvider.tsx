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
import { useUserId } from '@core/context/user';
import {
  $isCodeHighlightNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from '@lexical/code';
import { mergeRegister } from '@lexical/utils';
import { createAwareness } from '@macro-inc/collaboration/collab/awareness';
import { createSyncEngine } from '@macro-inc/collaboration/collab/engine';
import { logSyncService } from '@macro-inc/collaboration/collab/logger';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
} from '@macro-inc/collaboration/collab/snapshot-store';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import { createWALSyncSource } from '@macro-inc/collaboration/collab/wal';
import {
  $isCustomCodeNode,
  $updateAllNodeIds,
  COLLABORATION_TAG,
  CustomCodeNode,
  LOCAL_STATUS_TAG,
  type NodeIdMappings,
  SKIP_DOM_SELECTION_TAG,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from '@macro-inc/lexical-core';
import type { Span } from '@macro-inc/observability';
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
  type JSX,
  on,
  onCleanup,
  type Setter,
} from 'solid-js';

type MutatedNodes = UpdateListenerPayload['mutatedNodes'];

/** Hooks into the caller's tracing, all optional. */
export type CollabObservability = {
  /** Resume the caller's open span for this session id, if any. */
  resumeSpan?: (id: string) => Span | undefined;
  /** End the caller's span for this session id. */
  endSpan?: (id: string) => void;
};

export type CollabProviderProps = {
  editor: LexicalEditor;
  pluginManager: PluginManager;
  editorContainerRef: HTMLDivElement;
  highlightLayerRef: HTMLDivElement;
  mappings: NodeIdMappings;
  editorFocus: Accessor<boolean>;
  setEditorReady: Setter<boolean>;
  setEditorError: Setter<MarkdownEditorErrors | null>;
  loroManager: LoroManager;
  /**
   * The live sync source for this session. Must be non-undefined by the time
   * the provider mounts — the check below is NOT reactive, so gate mounting
   * with `<Show when={syncSource()}>` (or equivalent) in the caller.
   */
  syncSource: Accessor<LiveSyncSource | undefined>;
  /**
   * Whether the content source has resolved to a live sync-service session.
   * The md block passes `isSourceSyncService(blockSource)`; standalone collab
   * surfaces are always live and pass `() => true`.
   */
  sourceReady: Accessor<boolean>;
  canEdit: Accessor<boolean | undefined>;
  canComment: Accessor<boolean | undefined>;
  /** External error state; the engine stops when it becomes non-null. */
  editorError: Accessor<MarkdownEditorErrors | null>;
  observability?: CollabObservability;
  /** Optional status UI (e.g. the md block's CollabStatus chrome). */
  statusChrome?: JSX.Element;
};

export const FROM_LORO_TAG = 'from-loro';
export const CODE_HIGHLIGHT_IDS_TAG = 'code-highlight-ids-tag';

export const FORCE_SYNC_COMMAND = createCommand<void>('FORCE_SYNC_COMMAND');

/**
 * Wires a Lexical editor to a Loro sync session, in both directions:
 * remote state is reconciled onto the live Lexical tree by stable node id,
 * and local updates are diffed into Loro via the sync engine (with WAL
 * buffering for offline edits). Also renders remote peer cursors.
 *
 * Generic over where the session came from — an md-block document or a
 * standalone collab surface — via `syncSource`/`sourceReady`/`canEdit`
 * accessors instead of block-scoped signals.
 */
export function CollabProvider(props: CollabProviderProps) {
  const [didFirstSync, setDidFirstSync] = createSignal(false);
  const loroManager = props.loroManager;
  const syncSource = props.syncSource;
  const userId = useUserId();

  if (!syncSource()) return null;

  const resumeSpan = (id: string): Span | undefined =>
    props.observability?.resumeSpan?.(id);
  const endSpan = (id: string): void => props.observability?.endSpan?.(id);

  const awareness = createAwareness(
    loroManager.peerIdStr,
    userId(),
    lexicalSelectionCodec,
    {
      timeout: 5_000,
    }
  );

  const readOnly = () => !(props.canEdit() || props.canComment());

  const walSyncer = createWALSyncSource(syncSource()!);
  const syncEngine = createSyncEngine({
    loroManager,
    awareness,
    syncs: { wal: walSyncer, live: syncSource()! },
    bindings: {
      onRemoteState: (state) =>
        syncStateToLexical(state as unknown as SerializedEditorState),
    },
    readonly: readOnly,
    snapshotStore: new IDBSnapshotStore(
      LORO_SNAPSHOT_DB_NAME,
      syncSource()!.documentId
    ),
  });

  const { refreshRemoteCursors, RemoteCursorsOverlay } = useRemoteCursors({
    loroManager: loroManager,
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
    let manager = loroManager;
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
          () => loroManager.peerIdStr
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
    if (!loroManager) {
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
        loroManager,
        props.mappings,
        selection
      );

      if (!cursors) {
        console.warn('CollabProvider: Failed to convert selection to cursors');
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
            $afterSyncCursorUpdate(loroManager);
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
    if (!loroManager) {
      console.error(
        'registering sync state to lexical, but no manager -- this should never happen'
      );
      return;
    }
    // State updates tagged with 'FROM_LORO' are from the syncToLexical function
    // and should not be synced to the loroManager. This would cause an infinite loop.
    // LOCAL_STATUS_TAG updates carry only per-peer ownership state, which is
    // resolved independently on each client — producers of this tag must not
    // mutate node content in the same update, or those changes will be dropped here.
    if (
      tags.has(FROM_LORO_TAG) ||
      tags.has(COLLABORATION_TAG) ||
      tags.has(LOCAL_STATUS_TAG) ||
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

    $afterSyncCursorUpdate(loroManager);
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

  const [managerInitialized, setManagerInitialized] = createSignal(
    loroManager.initialized
  );
  onCleanup(loroManager.onInitializedChange(setManagerInitialized));

  /** Initializes the loroManager and starts the sync engine */
  createEffect(
    on(
      () => managerInitialized() ?? false,
      (isInitialized) => {
        if (!isInitialized) {
          logSyncService({
            documentId: syncSource()?.documentId ?? 'unknown',
            level: 'debug',
            context: {},
            message: 'CollabProvider: manager not yet initialized',
          });
          return;
        }

        if (props.sourceReady()) {
          // Get the current state from the loroManager
          // At this point, the loroManager should be initialized and should
          // have the initial state from the sync service
          const state = loroManager.state;
          const empty = state
            ? isStateEmpty(state.state as unknown as SerializedEditorState)
            : undefined;

          logSyncService({
            documentId: syncSource()!.documentId,
            level: 'info',
            context: { misc: { hasState: !!state, isEmpty: empty } },
            message: 'CollabProvider: manager initialized, initializing editor',
          });

          //TODO: some more descriptive user facing error should be displayed here
          if (!state) {
            logSyncService({
              documentId: syncSource()!.documentId,
              level: 'error',
              context: {},
              message:
                'editor init: no state from loroManager — editor will NOT become ready (skeleton stays)',
            });
            endSpan(syncSource()!.documentId);
            return;
          }

          // Indicate that we have completed the first sync
          setDidFirstSync(true);

          // Initialize the editor with the initial state from the sync service
          if (empty) {
            logSyncService({
              documentId: syncSource()!.documentId,
              level: 'debug',
              context: {},
              message: 'editor init: empty',
            });
            initializeEditorEmpty(props.editor, () => loroManager.peerIdStr);
          } else {
            logSyncService({
              documentId: syncSource()!.documentId,
              level: 'debug',
              context: {},
              message: 'editor init: versioned state',
            });
            const initError = initializeEditorWithVersionedState(
              props.editor,
              state.state as unknown as SerializedEditorState,
              () => loroManager.peerIdStr
            );
            if (initError !== null) {
              logSyncService({
                documentId: syncSource()!.documentId,
                level: 'error',
                context: { misc: { initError } },
                message:
                  'editor init: initializeEditorWithVersionedState failed',
              });
              props.setEditorError(initError);
              endSpan(syncSource()!.documentId);
              return;
            }
          }

          // Start the sync engine
          startSync();
          props.setEditorReady(true);
          const documentId = syncSource()!.documentId;
          resumeSpan(documentId)?.event('editor.ready');
          endSpan(documentId);
          logSyncService({
            documentId: syncSource()!.documentId,
            level: 'info',
            context: {},
            message: 'editor ready (skeleton cleared)',
          });
        } else {
          logSyncService({
            documentId: syncSource()?.documentId ?? 'unknown',
            level: 'debug',
            context: {},
            message:
              'editor init: source is not sync-service, skipping editor init (skeleton stays)',
          });
        }
      }
    )
  );

  createEffect(
    on(props.editorError, () => {
      if (props.editorError() !== null) {
        syncEngine.stop();
      }
    })
  );

  onCleanup(() => {
    syncEngine.stop();
    walSyncer.destroy();
    const documentId = syncSource()?.documentId;
    if (documentId) endSpan(documentId);
  });

  return (
    <>
      <RemoteCursorsOverlay
        anchorElem={props.editorContainerRef}
        highlightLayer={props.highlightLayerRef}
      />
      {props.statusChrome}
    </>
  );
}
