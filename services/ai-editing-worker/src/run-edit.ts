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
import { Telemetry } from '@macro-inc/observability';
import type { LanguageModel } from 'ai';
import { fastEditor, supervisor } from './ai-editing/agents';
import type { DocumentOp } from './ai-editing/editor';
import type { CodeRunner } from './ai-editing/runtime';
import type { UsageEntry } from './ai-editing/token-tracker';
import type { CoderRunCode, DispatchEditTrace } from './ai-editing/tools';
import { serializeWithXml } from './ai-editing/utils';
import { EditingWorkspace } from './editing-workspace';
import { buildTraceSession, type TraceSession } from './trace-log';

export type Provider = 'anthropic' | 'cerebras' | 'openai' | 'google';

export type Model = {
  provider: Provider;
  model: string;
};

/**
 * `supervised` is the full interpreter → supervisor → coders pipeline.
 * `fast` skips all of that: one model sees the whole document and edits it
 * directly through `runCode`. See ai-editing/agents/fast.ts.
 */
export type EditMode = 'supervised' | 'fast';

export type Models = {
  supervisor: Model;
  interpret: Model;
  coding: Model;
};

/** The three roles of the supervised pipeline. */
export type SupervisedModels = {
  supervisor: LanguageModel;
  interpret: LanguageModel;
  /** Fresh fallback chain per coder, so one coder's fallback state does not
   *  leak into a sibling running in parallel. */
  coding: () => LanguageModel;
};

/**
 * Only the pipeline the request runs is resolved, so a request never touches
 * a provider it will not call: a supervised edit must not fail because the
 * fast chain's key is missing, and vice versa.
 */
export type ResolvedModels = {
  supervised?: SupervisedModels;
  fast?: LanguageModel;
};

export type RunEditArgs = {
  /** Live sync source, already constructed by the caller (ws in prod). */
  source: SyncServiceSource;
  documentId: string;
  prompt: string;
  models: ResolvedModels;
  mode?: EditMode;
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

  // The manager owns the one true (merged) doc + mirror.
  const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: args.documentId,
  });

  await Telemetry.span('edit.sync_init', async (span) => {
    const initialResult = await source.doInitialSync();
    if (initialResult.isErr()) {
      source.cleanup();
      const e = initialResult.error;
      const err = new Error(`initial sync failed: ${e.type} (${e.duration}ms)`);
      span.error(err);
      throw err;
    }
    const initial = initialResult.value;
    span.setAttr('snapshot.bytes', initial.snapshot.byteLength);

    const initResult = await manager.initializeFromSnapshot(initial.snapshot);
    if (initResult.isErr()) {
      source.cleanup();
      const err = new Error(
        `failed to initialize from snapshot: ${initResult.error[0]?.message}`
      );
      span.error(err);
      throw err;
    }
  });

  // When the caller applies the returned ops locally instead, propagating
  // here too would double the content — so route live sync to a no-op sink
  // that acks everything and forwards nothing.
  const shouldPropagate = args.propagate ?? true;
  // Typing animations exist for people watching the shared doc. With no
  // propagation nobody can watch, so every animation pause is pure latency —
  // measured at 3.4 s of a 6.3 s fast-mode step.
  const typingAnimations = shouldPropagate ? args.typingAnimations : false;
  const liveSource: LiveSyncSource = shouldPropagate
    ? source
    : createNoopLiveSyncSource(args.documentId);

  const wal = new WALSyncer<RawUpdate>(
    new InMemoryWALStore<RawUpdate>(),
    (updates) => liveSource.pushUpdate(updates)
  );

  // The workspace owns the editing surface + its two-way sync with Loro, and
  // hands out per-coder writers. Under debug it also records a replay trace.
  const { workspace, initialDocument } = await Telemetry.span(
    'edit.hydrate',
    async (span) => {
      const workspace = new EditingWorkspace(manager, liveSource, wal);
      const initialDocument = serializeWithXml(workspace.session);
      span.setAttr('document.chars', initialDocument.length);
      return { workspace, initialDocument };
    }
  );

  const allOps: DocumentOp[] = [];
  const coderCodeBlocks: CoderRunCode[][][] = [];
  const dispatchEditTraces: DispatchEditTrace[][] = [];
  const sessionId = crypto.randomUUID();
  const startedAt = new Date();
  try {
    const shared = {
      borrowWriter: () => workspace.borrowWriter(),
      typingAnimations,
      sleep: args.sleep,
      signal: args.signal,
      runner: args.runner,
      onOps: (ops: DocumentOp[]) => allOps.push(...ops),
      onCoderResult: (codes: CoderRunCode[]) => coderCodeBlocks.push([codes]),
      onEditTrace: (edit: DispatchEditTrace) => dispatchEditTraces.push([edit]),
    };
    const {
      totalUsage,
      steps,
      stepDurationsMs,
      intent,
      interpretDurationMs,
      clarification,
    } = await (args.mode === 'fast' ? runFast() : runSupervised());

    async function runSupervised() {
      const models = args.models.supervised;
      if (!models)
        throw new Error('supervised mode requires models.supervised');
      return supervisor(workspace.session, args.prompt, models, {
        ...shared,
        interpret: args.interpret,
      });
    }

    async function runFast() {
      const model = args.models.fast;
      if (!model) throw new Error('fast mode requires models.fast');
      const result = await fastEditor(
        workspace.session,
        args.prompt,
        model,
        shared
      );
      return { ...result, intent: '', interpretDurationMs: undefined };
    }

    // Drain the queued propagates (plus a final catch-all sync) and ensure every
    // commit reached the server before we disconnect. No-op sink when not
    // propagating, so this is harmless either way.
    await Telemetry.span('edit.flush', async () => {
      await workspace.flush();
      await wal.flush();
    });

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
