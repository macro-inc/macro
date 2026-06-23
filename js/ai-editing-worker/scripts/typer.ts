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
import { connectPeer } from "../src/peer";

const { wssUrl } = await args("$0 <wss-url>");

const { doc, mirror, peerPool, sendAwareness, disconnect } =
	await connectPeer(wssUrl);

const session = createEditingSession();
loadSnapshot(session, mirror.getState() as SerializedEditorState);

const propagate = () => {
	const peer = peerPool.rotate();
	if (peer !== undefined) {
		doc.commit();
		doc.setPeerId(peer);
	}
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
	send: sendAwareness,
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
disconnect();
