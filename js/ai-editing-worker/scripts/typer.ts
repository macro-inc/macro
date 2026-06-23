import "../src/globals";
import { args } from "./utils";
import { $getRoot } from "lexical";
import type { SerializedEditorState } from "lexical";
import { $getId } from "../../lexical-core/plugins/nodeIdPlugin";
import {
	createEditingSession,
	loadSnapshot,
	toSnapshot,
} from "../src/ai-editing/ai-toolkit";
import { Doc } from "../src/ai-editing/doc/doc";
import {
	AI_NAMES,
	COLORS,
	realAwarenessSource,
} from "../src/ai-editing/awareness/awareness-source";
import { runEditorCode } from "../src/ai-editing/runtime";
import { LoroDoc } from "loro-crdt";
import { Mirror } from "@loro-mirror/packages/core/src";
import { MARKDOWN_LORO_SCHEMA, type MarkdownLoroSchemaType } from "../../lexical-core/markdown-loro-schema";
import { WorkerSyncSource } from "../src/sync-source";

const { wssUrl } = await args("$0 <wss-url>");

const source = new WorkerSyncSource(wssUrl, "", undefined);
const { snapshot } = await source.waitForInitialSync();

const doc = new LoroDoc();
const mirror = new Mirror<MarkdownLoroSchemaType>({ doc, schema: MARKDOWN_LORO_SCHEMA });
doc.import(snapshot);
doc.subscribeLocalUpdates((update) => source.pushUpdate([update]));

const session = createEditingSession();
loadSnapshot(session, mirror.getState() as SerializedEditorState);

const propagate = () => {
	const buf = new Uint8Array(8);
	crypto.getRandomValues(buf);
	const newPeer = new DataView(buf.buffer).getBigUint64(0, false);
	doc.commit();
	doc.setPeerId(newPeer);
	source.registerPeerId(newPeer);
	mirror.setState(toSnapshot(session) as never);
};

const firstId = session.editor.getEditorState().read(() =>
	$getId($getRoot().getFirstChildOrThrow()),
);

if (!firstId) throw new Error("document has no nodes");

const paragraphs = [
	"The quick brown fox jumps over the lazy dog, and then, having completed that particular feat of athletic prowess, paused to reflect on the existential implications of being a fox in a world that seemingly only exists to test the typographic completeness of font families and keyboard layouts.",
	"It was a dark and stormy night, or at least that is what the weather forecast had suggested earlier in the week, though by the time the actual evening arrived the clouds had largely dispersed, leaving behind only a faint drizzle and the lingering sense that meteorology is, at its core, an exercise in optimistic uncertainty.",
	"The history of human civilization can be understood, if one squints sufficiently and ignores a great many inconvenient counterexamples, as a long and winding journey from sitting in caves wondering what that rustling noise was, all the way to sitting in offices wondering what that notification sound was, which is to say the fundamental anxieties have remained remarkably consistent.",
];

const awareness = realAwarenessSource({
	mirror,
	doc,
	send: (bytes) => source.pushAwareness(bytes),
	name: AI_NAMES[0]!,
	color: COLORS[0]!,
});

const inserts = paragraphs
	.map(
		(text, i) =>
			i === 0
				? `const ref0 = editor.insertParagraphAfter('${firstId}', ${JSON.stringify(text)});`
				: `const ref${i} = editor.insertParagraphAfter(ref${i - 1}, ${JSON.stringify(text)});`,
	)
	.join("\n");

await runEditorCode({
	session,
	doc: new Doc(session, propagate),
	code: inserts,
	awarenessSource: awareness,
});

awareness.clear();
source.cleanup();
