import type { LanguageModel } from 'ai';
import { LoroManager } from '../../app/packages/core/collab/manager';
import type { RawUpdate } from '../../app/packages/core/collab/shared';
import {
  InMemoryWALStore,
  WALSyncer,
} from '../../app/packages/core/collab/wal';
import { MARKDOWN_LORO_SCHEMA } from '../../lexical-core/markdown-loro-schema';
import { supervisor } from './ai-editing/agents';
import type { DocumentOp } from './ai-editing/editor';
import type { CodeRunner } from './ai-editing/runtime';
import type { UsageEntry } from './ai-editing/token-tracker';
import { serializeWithXml } from './ai-editing/utils';
import { EditingWorkspace } from './editing-workspace';
import { createWorkerSyncSource } from './sources';
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
  /** Scales every animation pause; injected so unwatched edits can play faster. */
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  /** Run an intent-interpretation pass before dispatching edits. */
  interpret?: boolean;
  /** Include a markdown trace of all supervisor steps in the result. */
  debug?: boolean;
};

export type { UsageEntry };

export type RunEditResult = {
  usage: UsageEntry[];
  ops: DocumentOp[];
  /** Markdown trace of the session; always built so it can be persisted. */
  trace: string;
  /** Unique id for this edit session; keys the persisted trace. */
  sessionId: string;
  clarification?: string;
};

export async function runEditSession(
  args: RunEditArgs
): Promise<RunEditResult> {
  const source = createWorkerSyncSource(
    args.wsUrl,
    args.documentId,
    args.signal
  );
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

  const wal = new WALSyncer<RawUpdate>(
    new InMemoryWALStore<RawUpdate>(),
    (updates) => source.pushUpdate(updates)
  );

  // The workspace owns the editing surface + its two-way sync with Loro, and
  // hands out per-coder writers. Under debug it also records a replay trace.
  const workspace = new EditingWorkspace(manager, source, wal);

  const allOps: DocumentOp[] = [];
  // code, per coder, per batch
  const coderCodeBlocks: string[][][] = [];
  const sessionId = crypto.randomUUID();
  const startedAt = new Date();
  const initialDocument = serializeWithXml(workspace.session);
  try {
    const { totalUsage, steps, stepDurationsMs, intent, clarification } =
      await supervisor(
      workspace.session,
      args.prompt,
      args.models,
      {
        borrowWriter: () => workspace.borrowWriter(),
        typingAnimations: args.typingAnimations,
        sleep: args.sleep,
        signal: args.signal,
        interpret: args.interpret,
        runner: args.runner,
        onOps: (ops) => allOps.push(...ops),
        onCoderResult: (codes) => coderCodeBlocks.push(codes),
      }
    );

    // Drain the queued propagates (plus a final catch-all sync) and ensure every
    // commit reached the server before we disconnect.
    await workspace.flush();
    await wal.flush();

    const usage = totalUsage.toEntries();

    const trace = buildTraceLog(
      {
        documentId: args.documentId,
        prompt: args.prompt,
        startedAt,
        initialDocument,
        intent,
        coderCodeBlocks,
        stepDurationsMs,
      },
      steps as any,
      usage
    );

    console.log(JSON.stringify({ documentId: args.documentId, debug: trace }));

    return {
      usage,
      ops: allOps,
      trace,
      sessionId,
      clarification,
    };
  } finally {
    workspace.dispose();
    wal.destroy();
    manager.dispose();
    source.cleanup();
  }
}
