import type { LanguageModel } from "ai";
import type { SerializedEditorState } from "lexical";
import { runAgent, type SearchContacts } from "./ai-editing/agents/supervisor";
import { serializeWithXml } from "./ai-editing/utils";
import { buildTraceLog } from "./trace-log";
import {
	createEditingSession,
	loadSnapshot,
	toSnapshot,
} from "./ai-editing/ai-toolkit";
import { realAwarenessSource } from "./ai-editing/awareness/awareness-source";
import type { DocumentOp } from "./ai-editing/editor/ops";
import { LoroPeerPool } from "./ai-editing/loro/loro-peer-pool";
import type { CodeRunner } from "./ai-editing/runtime";
import { SyncEngine } from "../../app/packages/core/collab/engine";
import { LoroManager } from "../../app/packages/core/collab/manager";
import { InMemoryWALStore, WALSyncer } from "../../app/packages/core/collab/wal";
import type { RawUpdate } from "../../app/packages/core/collab/shared";
import { MARKDOWN_LORO_SCHEMA } from "../../lexical-core/markdown-loro-schema";
import { createWorkerAwareness, WorkerSyncSource } from "./sync-source";

/** How many distinct loro peers the AI's edits are spread across. */
const PEER_POOL_SIZE = 8;

export type RunEditArgs = {
	wsUrl: string;
	documentId: string;
	prompt: string;
	model: LanguageModel;
	childModel?: LanguageModel;
	/** 1M-context model the supervisor falls back to for large documents. */
	largeModel?: LanguageModel;
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
};

export type RunEditResult = {
	usage: { inputTokens: number; outputTokens: number };
	ops: DocumentOp[];
	trace?: string;
};

export async function runEditSession(args: RunEditArgs): Promise<RunEditResult> {
	const source = new WorkerSyncSource(args.wsUrl, args.documentId, args.signal);
	const initial = await source.waitForInitialSync();

	// The manager owns the one true (merged) doc + mirror. Defer state changes to
	// the engine on a microtask: loro fires the mirror subscriber synchronously
	// during `importUpdate`, and the engine guards remote handling with a mutex —
	// calling `onStateUpdate` inline would re-enter that lock. (The browser gets
	// this deferral for free via a Solid effect; here we do it by hand.)
	let engine: SyncEngine<typeof MARKDOWN_LORO_SCHEMA, unknown> | undefined;
	const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
		liveSyncSource: () => source,
		wasDirty: false,
	});
	manager.onStateChange((u) =>
		queueMicrotask(() => engine?.onStateUpdate(u)),
	);

	const initResult = await manager.initializeFromSnapshot(initial.snapshot);
	if (initResult.isErr()) {
		source.cleanup();
		throw new Error(`failed to initialize from snapshot: ${initResult.error[0]?.message}`);
	}

	// The AI's editing surface — seeded from the merged state and kept current.
	const session = createEditingSession();
	loadSnapshot(
		session,
		manager.mirror!.getState() as unknown as SerializedEditorState,
	);

	const awareness = createWorkerAwareness(manager.peerIdStr);
	const wal = new WALSyncer<RawUpdate>(new InMemoryWALStore<RawUpdate>(), (updates) =>
		source.pushUpdate(updates),
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

	// Attribute the AI's commits to a bounded pool of distinct peer ids so the
	// doc history reads as several collaborators. Register every pooled id up
	// front (the server maps each to this connection/user).
	const peerPool = LoroPeerPool.fromSeed(
		manager.peerId as unknown as bigint,
		PEER_POOL_SIZE,
	);
	for (const peerid of peerPool.peerIds()) source.registerPeerId(peerid);

	// Each `propagate` syncs the *current* session state through the engine. We
	// serialize on a promise chain (the executor calls `propagate` synchronously
	// between animated ops) and snapshot inside the task so it reflects any
	// remote reconcile that landed since — then rotate the peer id before the
	// commit, flushing pending ops to the prior peer first.
	let chain: Promise<void> = Promise.resolve();
	const propagate = () => {
		chain = chain.then(async () => {
			const peer = peerPool.rotate();
			if (peer !== undefined) {
				manager.doc.commit();
				manager.doc.setPeerId(peer);
			}
			const snap = toSnapshot(session) as any;
			const snapBlocks = snap?.root?.children;
			if (Array.isArray(snapBlocks)) {
				console.log('[loro-debug] syncStateToLoro snapshot block types:', snapBlocks.map((b: any) => `${b?.type}/${b?.$?.id}`));
			}
			await engine!.syncStateToLoro(snap as never);
		});
	};

	const allOps: DocumentOp[] = [];
	const startedAt = new Date();
	const initialDocument = args.debug ? serializeWithXml(session) : undefined;
	try {
		const { totalUsage, steps, intent } = await runAgent(session, args.prompt, args.model, {
			propagate,
			makeAwareness: (name, color) =>
				realAwarenessSource({
					mirror: manager.mirror!,
					doc: manager.doc,
					send: (bytes) => source.pushAwareness(bytes),
					name,
					color,
				}),
			childModel: args.childModel,
			largeModel: args.largeModel,
			typingAnimations: args.typingAnimations,
			signal: args.signal,
			interpret: args.interpret,
			runner: args.runner,
			onOps: (ops) => allOps.push(...ops),
			searchContacts: args.searchContacts ?? (() => Promise.resolve([])),
		});

		// Drain the last queued propagate + ensure every commit reached the server
		// before we disconnect.
		await chain;
		// Debug: log block types in the committed Loro doc to verify block-type changes landed.
		const loroBlocks = (manager.doc.toJSON() as any)?.root?.children;
		if (Array.isArray(loroBlocks)) {
			console.log('[loro-debug] committed block types:', loroBlocks.map((b: any) => `${b?.type}/${b?.$?.id}`));
		}
		await wal.flush();

		const usage = {
			inputTokens: totalUsage.inputTokens ?? 0,
			outputTokens: totalUsage.outputTokens ?? 0,
		};

		const trace = args.debug
			? buildTraceLog(
					{ documentId: args.documentId, prompt: args.prompt, startedAt, initialDocument, intent },
					steps as any,
					usage,
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
