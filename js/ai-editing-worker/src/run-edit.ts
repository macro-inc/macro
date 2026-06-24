import type { InferType } from '@loro-mirror/packages/core/src';
import type { LanguageModel } from 'ai';
import type { SerializedEditorState } from 'lexical';
import { SyncEngine } from '../../app/packages/core/collab/engine';
import { LoroManager } from '../../app/packages/core/collab/manager';
import type { RawUpdate } from '../../app/packages/core/collab/shared';
import {
  InMemoryWALStore,
  WALSyncer,
} from '../../app/packages/core/collab/wal';
import {
  MARKDOWN_LORO_SCHEMA,
  type MarkdownLoroSchemaType,
} from '../../lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '../../lexical-core/plugins/nodeIdPlugin';
import {
  type SearchContacts,
  type SearchDocuments,
  supervisor,
} from './ai-editing/agents/supervisor';
import {
  createEditingSession,
  loadSnapshot,
  toSnapshot,
} from './ai-editing/ai-toolkit';
import { realAwarenessSource } from './ai-editing/awareness/awareness-source';
import { sharedPeerPool } from './ai-editing/awareness/peer-pool';
import type { DocumentOp } from './ai-editing/editor/ops';
import type { CodeRunner } from './ai-editing/runtime';
import type { UsageEntry } from './ai-editing/token-tracker';
import { serializeWithXml } from './ai-editing/utils';
import { createWorkerAwareness, WorkerSyncSource } from './sync-source';
import { buildTraceLog } from './trace-log';

export type Model = {
  provider: 'anthropic' | 'cerebras' | 'openai';
  model: string;
};

export type Models = {
  supervisor: Model;
  interpret: Model;
  coding: Model;
};

export type ResolvedModels = {
  supervisor: LanguageModel;
  interpret: LanguageModel;
  coding: LanguageModel;
};

export type RunEditArgs = {
  wsUrl: string;
  documentId: string;
  prompt: string;
  models: ResolvedModels;
  /** Snippet runner — QuickJS sandbox in prod, `new Function` in local dev. */
  runner?: CodeRunner;
  typingAnimations?: boolean;
  signal?: AbortSignal;
  /** Run an intent-interpretation pass before dispatching edits. */
  interpret?: boolean;
  /** Include a markdown trace of all supervisor steps in the result. */
  debug?: boolean;
  /** Resolve a name query to matching contacts/users. Enables mention support. */
  searchContacts?: SearchContacts;
  /** Resolve a name/keyword query to documents. Enables document-card insertion. */
  searchDocuments?: SearchDocuments;
};

export type { UsageEntry };

export type RunEditResult = {
  usage: UsageEntry[];
  ops: DocumentOp[];
  trace?: string;
};

export async function runEditSession(
  args: RunEditArgs
): Promise<RunEditResult> {
  const source = new WorkerSyncSource(args.wsUrl, args.documentId, args.signal);
  const initial = await source.waitForInitialSync();

  // The manager owns the one true (merged) doc + mirror. Defer state changes to
  // the engine on a microtask: loro fires the mirror subscriber synchronously
  // during `importUpdate`, and the engine guards remote handling with a mutex —
  // calling `onStateUpdate` inline would re-enter that lock. (The browser gets
  // this deferral for free via a Solid effect; here we do it by hand.)
  let engine: SyncEngine<typeof MARKDOWN_LORO_SCHEMA, unknown> | undefined;
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: args.documentId,
  });
  manager.onStateChange((u) => queueMicrotask(() => engine?.onStateUpdate(u)));

  const initResult = await manager.initializeFromSnapshot(initial.snapshot);
  if (initResult.isErr()) {
    source.cleanup();
    throw new Error(
      `failed to initialize from snapshot: ${initResult.error[0]?.message}`
    );
  }

  // The AI's editing surface — seeded from the merged state and kept current.
  const session = createEditingSession();
  loadSnapshot(
    session,
    manager.mirror!.getState() as unknown as SerializedEditorState
  );

  const awareness = createWorkerAwareness(manager.peerIdStr);
  const wal = new WALSyncer<RawUpdate>(
    new InMemoryWALStore<RawUpdate>(),
    (updates) => source.pushUpdate(updates)
  );

  engine = new SyncEngine({
    loroManager: manager,
    awareness,
    syncs: { wal, live: source },
    bindings: {
      // A remote (human) edit landed — fold it into the AI's session so its
      // next diff is a clean delta and the user's text is preserved.
      onRemoteState: (state) =>
        loadSnapshot(session, state as unknown as SerializedEditorState),
    },
  });
  engine.start();

  // Each `propagate` syncs the *current* session state through the engine. We
  // serialize on a promise chain (the executor calls `propagate` synchronously
  // between animated ops) and snapshot inside the task so it reflects any
  // remote reconcile that landed since — then switch to a fresh random peer id
  // before the commit so each edit batch is attributed to a distinct author.
  let chain: Promise<void> = Promise.resolve();
  const propagate = () => {
    chain = chain.then(async () => {
      const buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      const newPeer = new DataView(buf.buffer).getBigUint64(0, false);
      manager.doc.commit();
      manager.doc.setPeerId(newPeer);
      source.registerPeerId(newPeer);
      // Prism creates code-highlight nodes without ids (skipTransforms).
      // Stamp ids before snapshotting so the Loro mirror matches them by id
      // instead of re-inserting duplicates on every sync.
      session.editor.update(() => $updateAllNodeIds(session.ids), {
        discrete: true,
      });
      const snap = toSnapshot(session);
      await engine!.syncStateToLoro(
        snap as unknown as InferType<MarkdownLoroSchemaType>
      );
    });
  };

  const allOps: DocumentOp[] = [];
  const startedAt = new Date();
  const initialDocument = args.debug ? serializeWithXml(session) : undefined;
  try {
    const { totalUsage, steps, intent } = await supervisor(
      session,
      args.prompt,
      args.models,
      {
        propagate,
        peerPool: sharedPeerPool,
        makeAwareness: (name, color) =>
          realAwarenessSource({
            mirror: manager.mirror!,
            doc: manager.doc,
            send: (bytes) => source.pushAwareness(bytes),
            name,
            color,
          }),
        typingAnimations: args.typingAnimations,
        signal: args.signal,
        interpret: args.interpret,
        runner: args.runner,
        onOps: (ops) => allOps.push(...ops),
        searchContacts: args.searchContacts ?? (() => Promise.resolve([])),
        searchDocuments: args.searchDocuments ?? (() => Promise.resolve([])),
      }
    );

    // A final propagate catches any Prism tokenization that settled after the
    // last edit's propagate (its code-highlight nodes are otherwise unsynced).
    propagate();
    // Drain the last queued propagate + ensure every commit reached the server
    // before we disconnect.
    await chain;
    // Debug: log block types in the committed Loro doc to verify block-type changes landed.
    const loroBlocks = (manager.doc.toJSON() as any)?.root?.children;
    if (Array.isArray(loroBlocks)) {
      console.log(
        '[loro-debug] committed block types:',
        loroBlocks.map((b: any) => `${b?.type}/${b?.$?.id}`)
      );
    }
    await wal.flush();

    const usage = totalUsage.toEntries();

    const trace = args.debug
      ? buildTraceLog(
          {
            documentId: args.documentId,
            prompt: args.prompt,
            startedAt,
            initialDocument,
            intent,
          },
          steps as any,
          usage
        )
      : undefined;

    return { usage, ops: allOps, trace };
  } finally {
    engine.stop();
    wal.destroy();
    manager.dispose();
    source.cleanup();
  }
}
