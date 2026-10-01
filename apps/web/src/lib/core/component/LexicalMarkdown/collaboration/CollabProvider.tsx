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
  automergeSyncState,
  initializeEditorEmpty,
  initializeEditorWithVersionedState,
  isStateEmpty,
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
import type { AutomergeManager } from '@macro-inc/collaboration/collab/manager';
import {
  AUTOMERGE_SNAPSHOT_DB_NAME,
  IDBSnapshotStore,
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
  stripDraftCommentMarks,
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
  automergeManager: AutomergeManager;
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

export const FROM_AUTOMERGE_TAG = 'from-automerge';
export const CODE_HIGHLIGHT_IDS_TAG = 'code-highlight-ids-tag';

export const FORCE_SYNC_COMMAND = createCommand<void>('FORCE_SYNC_COMMAND');

/**
 * Wires a Lexical editor to an Automerge sync session, in both directions:
 * remote state is reconciled onto the live Lexical tree by stable node id,
 * and local updates are diffed into Automerge via the sync engine (with WAL
 * buffering for offline edits). Also renders remote peer cursors.
 *
 * Generic over where the session came from — an md-block document or a
 * standalone collab surface — via `syncSource`/`sourceReady`/`canEdit`
 * accessors instead of block-scoped signals.
 */
export function CollabProvider(props: CollabProviderProps) {
  const [didFirstSync, setDidFirstSync] = createSignal(false);
  const automergeManager = props.automergeManager;
  const syncSource = props.syncSource;
  const userId = useUserId();

  if (!syncSource()) return null;

  const resumeSpan = (id: string): Span | undefined =>
    props.observability?.resumeSpan?.(id);
  const endSpan = (id: string): void => props.observability?.endSpan?.(id);

  const awareness = createAwareness(
    automergeManager.peerIdStr,
    userId(),
    lexicalSelectionCodec,
    {
      timeout: 5_000,
    }
  );

  const readOnly = () => !(props.canEdit() || props.canComment());

  const walSyncer = createWALSyncSource(syncSource()!);
  const syncEngine = createSyncEngine({
    automergeManager,
    awareness,
    syncs: { wal: walSyncer, live: syncSource()! },
    bindings: {
      onRemoteState: (state) =>
        syncStateToLexical(state as unknown as SerializedEditorState),
    },
    readonly: readOnly,
    snapshotStore: new IDBSnapshotStore(
      AUTOMERGE_SNAPSHOT_DB_NAME,
      syncSource()!.documentId
    ),
  });

  const { refreshRemoteCursors, RemoteCursorsOverlay } = useRemoteCursors({
    automergeManager: automergeManager,
    mapping: props.mappings,
    editor: props.editor,
    awareness: awareness,
  });

  /**
   * Responsible for syncing incoming state from the automerge manager to the lexical editor
   *
   * @param state - The state to sync to the lexical editor
   */
  function syncStateToLexical(state: SerializedEditorState) {
    if (!syncEngine.isRunning()) {
      console.warn('tried to sync state to lexical, but engine is not running');
      return;
    }
    const hadFocus = props.editorFocus();
    let manager = automergeManager;
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
          () => automergeManager.peerIdStr
        );

        // Queue microtask after this `editor.update` to ensure that all the nodeIds are updated
        queueMicrotask(() => {
          props.editor.update(() => {
            $updateAllNodeIds(props.mappings);
            // If we import a remote update, it's possible that the update
            // has shifted out own selection / cursor. We need to re-position our local
            // cursor based on the new lexical state using the stable AutomergeCursor.
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
        tag: FROM_AUTOMERGE_TAG,
        onUpdate: () => {
          refreshRemoteCursors();
        },
      }
    );
  }

  /** Convert the current local selection to a automerge cursor */
  function localCursorUpdate():
    | { awareness: LexicalSelectionAwareness; format: number }
    | undefined {
    if (!automergeManager) {
      console.error(
        'tried to convert selection to cursor, but no automerge manager'
      );
      return;
    }

    props.editor.read(() => {
      const selection = $getSelection();

      if (!selection) {
        return;
      }

      // Convert the current selection to a set of AutomergeCursors
      const cursors = $convertLexicalSelectionToCursors(
        automergeManager,
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

  /** Handle the cursor state after successful sync from Lexical->Automerge */
  function $afterSyncCursorUpdate(manager: AutomergeManager) {
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
   *    id-assigning node transform does not run on new highlights. This pass enforces ids before making it to Automerge.
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
            const stateToSync = automergeSyncState(
              props.editor.getEditorState()
            );
            await syncEngine.syncStateToAutomerge(stateToSync as any);
            $afterSyncCursorUpdate(automergeManager);
          },
        }
      );
    }
    return nodeKeysToUpdate.size > 0;
  }

  async function syncLexicalToAutomerge(
    state: EditorState,
    mutatedNodes: MutatedNodes,
    tags: Set<string>
  ) {
    if (!syncEngine.isRunning()) {
      console.warn(
        'tried to sync lexical state to automerge, but engine is not running'
      );
      return;
    }
    if (!automergeManager) {
      console.error(
        'registering sync state to lexical, but no manager -- this should never happen'
      );
      return;
    }
    // State updates tagged with 'FROM_AUTOMERGE' are from the syncToLexical function
    // and should not be synced to the automergeManager. This would cause an infinite loop.
    // LOCAL_STATUS_TAG updates carry only per-peer ownership state, which is
    // resolved independently on each client — producers of this tag must not
    // mutate node content in the same update, or those changes will be dropped here.
    if (
      tags.has(FROM_AUTOMERGE_TAG) ||
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
      // Do not try to send any state to Automerge until code highlight ids have resolved.
      if (codeNodeUpdateHandler(mutatedNodes)) {
        return false;
      }

      // Clean the state to remove any state properties that should not be synced
      const stateToSync = automergeSyncState(state);
      await syncEngine.syncStateToAutomerge(stateToSync as any);
    }

    $afterSyncCursorUpdate(automergeManager);
  }

  function lexicalStateSyncPlugin() {
    return mergeRegister(
      props.editor.registerUpdateListener(
        ({ editorState, tags, mutatedNodes }) => {
          syncLexicalToAutomerge(editorState, mutatedNodes, tags);
          return false;
        }
      ),
      props.editor.registerCommand(
        FORCE_SYNC_COMMAND,
        () => {
          const stateToSync = automergeSyncState(props.editor.getEditorState());
          syncEngine.syncStateToAutomerge(stateToSync as any);
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
    automergeManager.initialized
  );
  onCleanup(automergeManager.onInitializedChange(setManagerInitialized));

  /** Initializes the automergeManager and starts the sync engine */
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
          // Get the current state from the automergeManager
          // At this point, the automergeManager should be initialized and should
          // have the initial state from the sync service
          const state = automergeManager.state;
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
                'editor init: no state from automergeManager — editor will NOT become ready (skeleton stays)',
            });
            endSpan(syncSource()!.documentId);
            return;
          }

          // Indicate that we have completed the first sync
          setDidFirstSync(true);

          let hasAbandonedDrafts = false;

          // Initialize the editor with the initial state from the sync service
          if (empty) {
            logSyncService({
              documentId: syncSource()!.documentId,
              level: 'debug',
              context: {},
              message: 'editor init: empty',
            });
            initializeEditorEmpty(
              props.editor,
              () => automergeManager.peerIdStr
            );
          } else {
            logSyncService({
              documentId: syncSource()!.documentId,
              level: 'debug',
              context: {},
              message: 'editor init: versioned state',
            });
            const initialState =
              state.state as unknown as SerializedEditorState;
            const stateWithoutDrafts = stripDraftCommentMarks(initialState);
            hasAbandonedDrafts = stateWithoutDrafts !== initialState;
            const initError = initializeEditorWithVersionedState(
              props.editor,
              stateWithoutDrafts,
              () => automergeManager.peerIdStr
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
          // Remove drafts that earlier sessions left in the shared document.
          if (hasAbandonedDrafts && !readOnly()) {
            props.editor.dispatchCommand(FORCE_SYNC_COMMAND, undefined);
          }
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
