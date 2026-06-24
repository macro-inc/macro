// This is a small helper that uses the helpers of the ai worker to type random
// gibberish into a document

import "../src/globals";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { $getRoot } from "lexical";
import type { SerializedEditorState } from "lexical";
import { $getId, $updateAllNodeIds } from "../../lexical-core/plugins/nodeIdPlugin";
import {
	createEditingSession,
	loadSnapshot,
	toSnapshot,
} from "../src/ai-editing/ai-toolkit";
import { Doc } from "../src/ai-editing/doc/doc";
import { nextAiPeerId } from "../src/ai-editing/awareness/ai-peer";
import {
	AI_NAMES,
	COLORS,
	realAwarenessSource,
} from "../src/ai-editing/awareness/awareness-source";
import { DocumentEditor } from "../src/ai-editing/editor/document-editor";
import { type CodeRunner, runEditorCode } from "../src/ai-editing/runtime";
import { MARKDOWN_LORO_SCHEMA, type MarkdownLoroSchemaType } from "../../lexical-core/markdown-loro-schema";
import type { InferType } from "@loro-mirror/packages/core/src";
import { WorkerSyncSource, createWorkerAwareness } from "../src/sync-source";
import { LoroManager } from "../../app/packages/core/collab/manager";
import { SyncEngine } from "../../app/packages/core/collab/engine";
import { InMemoryWALStore, WALSyncer } from "../../app/packages/core/collab/wal";
import type { RawUpdate } from "../../app/packages/core/collab/shared";

const argv = await yargs(hideBin(process.argv)).usage("$0 <wss-url>").help().parse();
const wssUrl = argv._[0] as string | undefined;
if (!wssUrl) { yargs().showHelp(); process.exit(1); }

const source = new WorkerSyncSource(wssUrl, "", undefined);
const { snapshot } = await source.waitForInitialSync();

const manager = new LoroManager(MARKDOWN_LORO_SCHEMA, { documentId: "" });
let engine: SyncEngine<typeof MARKDOWN_LORO_SCHEMA, unknown> | undefined;
manager.onStateChange((u) => queueMicrotask(() => engine?.onStateUpdate(u)));

const initResult = await manager.initializeFromSnapshot(snapshot);
if (initResult.isErr()) throw new Error(`failed to initialize: ${initResult.error[0]?.message}`);

const session = createEditingSession();
loadSnapshot(session, manager.mirror!.getState() as unknown as SerializedEditorState);

const workerAwareness = createWorkerAwareness(manager.peerIdStr);
const wal = new WALSyncer<RawUpdate>(new InMemoryWALStore<RawUpdate>(), (updates) => source.pushUpdate(updates));
engine = new SyncEngine({
	loroManager: manager,
	awareness: workerAwareness,
	syncs: { wal, live: source },
	bindings: { onRemoteState: () => {} },
});
engine.start();

let chain: Promise<void> = Promise.resolve();
const propagate = () => {
	chain = chain.then(async () => {
		const newPeer = nextAiPeerId();
		manager.doc.commit();
		manager.doc.setPeerId(newPeer);
		source.registerPeerId(newPeer);
		session.editor.update(() => $updateAllNodeIds(session.ids), { discrete: true });
		await engine!.syncStateToLoro(toSnapshot(session) as unknown as InferType<MarkdownLoroSchemaType>);
	});
};

const awareness = realAwarenessSource({
	mirror: manager.mirror!,
	doc: manager.doc,
	send: (bytes) => source.pushAwareness(bytes),
	name: AI_NAMES[0]!,
	color: COLORS[0]!,
});

const firstId = session.editor.getEditorState().read(() =>
	$getId($getRoot().getFirstChildOrThrow()),
);
if (!firstId) throw new Error("document has no nodes");

const paragraphs = [
	"The quick brown fox jumps over the lazy dog, and then, having completed that particular feat of athletic prowess, paused to reflect on the existential implications of being a fox in a world that seemingly only exists to test the typographic completeness of font families and keyboard layouts.",
	"It was a dark and stormy night, or at least that is what the weather forecast had suggested earlier in the week, though by the time the actual evening arrived the clouds had largely dispersed, leaving behind only a faint drizzle and the lingering sense that meteorology is, at its core, an exercise in optimistic uncertainty.",
	"The history of human civilization can be understood, if one squints sufficiently and ignores a great many inconvenient counterexamples, as a long and winding journey from sitting in caves wondering what that rustling noise was, all the way to sitting in offices wondering what that notification sound was, which is to say the fundamental anxieties have remained remarkably consistent.",
];

const inserts = paragraphs
	.map(
		(text, i) =>
			i === 0
				? `const ref0 = editor.insertParagraphAfter('${firstId}', ${JSON.stringify(text)});`
				: `const ref${i} = editor.insertParagraphAfter(ref${i - 1}, ${JSON.stringify(text)});`,
	)
	.join("\n");

const runner: CodeRunner = (validIds, code) => {
	const refs = Array.from({ length: 128 }, (_, i) => `ref-${i + 1}`);
	const editor = new DocumentEditor({ validIds, refs });
	new Function("editor", code)(editor);
	return editor.drain();
};

await runEditorCode({
	session,
	doc: new Doc(session, propagate),
	code: inserts,
	awarenessSource: awareness,
	runner,
});

await chain;
await wal.flush();
awareness.clear();
engine.stop();
wal.destroy();
manager.dispose();
source.cleanup();
