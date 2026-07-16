import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import {
  createNoopLiveSyncSource,
  type LiveSyncSource,
} from '@macro-inc/collaboration/collab/source';
import {
  InMemoryWALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import type { LanguageModel } from 'ai';
import { supervisor } from './ai-editing/agents';
import type { DocumentOp } from './ai-editing/editor';
import type { CodeRunner } from './ai-editing/runtime';
import type { UsageEntry } from './ai-editing/token-tracker';
import type { CoderRunCode, DispatchEditTrace } from './ai-editing/tools';
import { serializeWithXml } from './ai-editing/utils';
import { EditingWorkspace } from './editing-workspace';
import { buildTraceSession, type TraceSession } from './trace-log';

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
  coding: () => LanguageModel;
};

export type RunEditArgs = {
  /** Live sync source, already constructed by the caller (ws in prod). */
  source: SyncServiceSource;
  documentId: string;
  prompt: string;
  models: ResolvedModels;
  /** Snippet runner — QuickJS sandbox in prod, `new Function` in local dev. */
  runner?: CodeRunner;
  typingAnimations?: boolean;
  /** Scales every animation pause; injected so unwatched edits can play faster. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** Run an intent-interpretation pass before dispatching edits. */
  interpret?: boolean;
  /** Include a markdown trace of all supervisor steps in the result. */
  debug?: boolean;
  /**
   * Commit edits to the shared Loro doc (default true). Set false to have the
   * caller receive the returned `ops` without them being committed.
   */
  propagate?: boolean;
};

export type { UsageEntry };

export type RunEditResult = {
  usage: UsageEntry[];
  ops: DocumentOp[];
  /** Structured trace of the session; stored as JSON, rendered to markdown on demand. */
  session: TraceSession;
  clarification?: string;
};

export async function runEditSession(
  args: RunEditArgs
): Promise<RunEditResult> {
  const source = args.source;
  const initialResult = await source.doInitialSync();
  if (initialResult.isErr()) {
    source.cleanup();
    const e = initialResult.error;
    throw new Error(`initial sync failed: ${e.type} (${e.duration}ms)`);
  }
  const initial = initialResult.value;

  // The manager owns the one true (merged) doc + mirror.
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: args.documentId,
  });

  const initResult = await manager.initializeFromSnapshot(initial.snapshot);
  if (initResult.isErr()) {
    source.cleanup();
    throw new Error(
      `failed to initialize from snapshot: ${initResult.error[0]?.message}`
    );
  }

  // When the caller applies the returned ops locally instead, propagating
  // here too would double the content — so route live sync to a no-op sink
  // that acks everything and forwards nothing.
  const shouldPropagate = args.propagate ?? true;
  const liveSource: LiveSyncSource = shouldPropagate
    ? source
    : createNoopLiveSyncSource(args.documentId);

  const wal = new WALSyncer<RawUpdate>(
    new InMemoryWALStore<RawUpdate>(),
    (updates) => liveSource.pushUpdate(updates)
  );

  // The workspace owns the editing surface + its two-way sync with Loro, and
  // hands out per-coder writers. Under debug it also records a replay trace.
  const workspace = new EditingWorkspace(manager, liveSource, wal);

  const allOps: DocumentOp[] = [];
  const coderCodeBlocks: CoderRunCode[][][] = [];
  const dispatchEditTraces: DispatchEditTrace[][] = [];
  const sessionId = crypto.randomUUID();
  const startedAt = new Date();
  const initialDocument = serializeWithXml(workspace.session);
  try {
    const {
      totalUsage,
      steps,
      stepDurationsMs,
      intent,
      interpretDurationMs,
      clarification,
    } = await supervisor(workspace.session, args.prompt, args.models, {
      borrowWriter: () => workspace.borrowWriter(),
      typingAnimations: args.typingAnimations,
      sleep: args.sleep,
      signal: args.signal,
      interpret: args.interpret,
      runner: args.runner,
      onOps: (ops) => allOps.push(...ops),
      onCoderResult: (codes) => coderCodeBlocks.push([codes]),
      onEditTrace: (edit) => dispatchEditTraces.push([edit]),
    });

    // Drain the queued propagates (plus a final catch-all sync) and ensure every
    // commit reached the server before we disconnect. No-op sink when not
    // propagating, so this is harmless either way.
    await workspace.flush();
    await wal.flush();

    const usage = totalUsage.toEntries();

    const session = buildTraceSession(
      {
        sessionId,
        documentId: args.documentId,
        prompt: args.prompt,
        startedAt,
        initialDocument,
        intent,
        interpretDurationMs,
        coderCodeBlocks,
        dispatchEditTraces,
        stepDurationsMs,
      },
      steps as any,
      usage
    );

    return {
      usage,
      ops: allOps,
      session,
      clarification,
    };
  } finally {
    workspace.dispose();
    wal.destroy();
    manager.dispose();
    source.cleanup();
  }
}
