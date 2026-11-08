// Execute the real mirror; do not duplicate its diff/container implementation here.
import {
	Cursor,
	LoroDoc,
	LoroMap,
	LoroList,
	LoroMovableList,
	LoroText,
	isContainer,
	type ContainerID,
} from "loro-crdt";
import { Mirror } from "../../../../../../../packages/loro-mirror/src/index";
import { MARKDOWN_LORO_SCHEMA } from "../../../../../../../packages/lexical-core/markdown-loro-schema";

type State = ReturnType<Mirror<typeof MARKDOWN_LORO_SCHEMA>["getState"]>;
type Run = { snapshot?: number[]; states: State[]; updates?: number[][] };
type RelayEvent =
	| { peer: number; state: State }
	| { peer: number; message: number };
type Request = {
	runs?: Run[];
	pair?: {
		snapshot: number[];
		updates: number[][];
		cursor: number[];
		textId: ContainerID;
	};
	relay?: { snapshot: number[]; events: RelayEvent[] };
};

function observe(doc: LoroDoc) {
	const kinds: Record<string, string> = {};
	function visit(value: unknown, path: string) {
		if (!isContainer(value)) return;
		kinds[path] = value.kind();
		if (value instanceof LoroMap) {
			for (const [key, item] of value.entries()) visit(item, `${path}/${key}`);
		} else if (value instanceof LoroList || value instanceof LoroMovableList) {
			for (let i = 0; i < value.length; i++)
				visit(value.get(i), `${path}/${i}`);
		}
	}
	visit(doc.getMap("root"), "root");
	return { value: doc.toJSON(), kinds };
}
const input: Request = await Bun.stdin.json();
if (input.pair) {
	const catalog = await Bun.file(
		new URL("../../../../../../../package.json", import.meta.url),
	).json();
	const sync = await Bun.file(
		new URL(
			"../../../../../../../services/sync-service/package-lock.json",
			import.meta.url,
		),
	).json();
	const cargo = await Bun.file(
		new URL("../../../../../../../Cargo.toml", import.meta.url),
	).text();
	const rustLock = await Bun.file(
		new URL("../../../../../../../Cargo.lock", import.meta.url),
	).text();
	const bunLock = await Bun.file(
		new URL("../../../../../../../bun.lock", import.meta.url),
	).text();
	const installed = await Bun.file(
		new URL(
			"../../../../../../../node_modules/loro-crdt/package.json",
			import.meta.url,
		),
	).json();
	if (
		catalog.workspaces.catalog["loro-crdt"] !== "1.17.1" ||
		installed.version !== "1.17.1" ||
		// The frozen Worker transcript driver uses its preserved server version;
		// this differential runs the workspace editor mirror on 1.17.1.
		sync.packages["node_modules/loro-crdt"].version !== "1.16.3" ||
		!cargo.includes('loro = "=1.17.1"') ||
		!cargo.includes('loro_server = { package = "loro", path = "vendor/loro-server/loro" }') ||
		!rustLock.includes('name = "loro"\nversion = "1.17.1"') ||
		!bunLock.includes('"loro-crdt": "1.17.1"') ||
		!bunLock.includes('"loro-crdt@1.17.1"')
	)
		throw new Error("Loro versions differ");
	const doc = new LoroDoc();
	doc.setPeerId("23");
	doc.setRecordTimestamp(false);
	doc.import(Uint8Array.from(input.pair.snapshot));
	for (const bytes of input.pair.updates) doc.import(Uint8Array.from(bytes));
	const resolved = doc.getCursorPos(
		Cursor.decode(Uint8Array.from(input.pair.cursor)),
	)?.offset;
	const baseline = doc.version();
	const text = doc.getContainerById(input.pair.textId);
	if (!(text instanceof LoroText))
		throw new Error("pair text container missing");
	// JS Loro positions use UTF-16. Rust positions use Unicode scalars.
	const cursor = text.getCursor(3, 0);
	if (!cursor) throw new Error("pair cursor missing");
	const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });
	const state = structuredClone(mirror.getState());
	state.root.children[0].children[0].text += "TSé";
	doc.setNextCommitTimestamp(4);
	mirror.setState(state);
	console.log(
		JSON.stringify({
			resolved,
			cursor: [...cursor.encode()],
			updates: [...doc.export({ mode: "update", from: baseline })],
			snapshot: [...doc.export({ mode: "snapshot" })],
			observation: observe(doc),
		}),
	);
	mirror.dispose();
	process.exit(0);
}
if (input.relay) {
	const docs = [new LoroDoc(), new LoroDoc()];
	docs.forEach((doc, i) => {
		doc.setPeerId(String(17 + i));
		doc.setRecordTimestamp(false);
		doc.import(Uint8Array.from(input.relay.snapshot));
	});
	const mirrors = docs.map(
		(doc) => new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA }),
	);
	const messages: Uint8Array[] = [];
	const observations = [];
	for (const event of input.relay.events) {
		if ("state" in event) {
			const before = docs[event.peer].version();
			mirrors[event.peer].setState(event.state);
			messages.push(docs[event.peer].export({ mode: "update", from: before }));
		} else {
			docs[event.peer].import(messages[event.message]);
		}
		observations.push(observe(docs[event.peer]));
	}
	console.log(JSON.stringify(observations));
	mirrors.forEach((mirror) => mirror.dispose());
	process.exit(0);
}
if (!input.runs) throw new Error("missing differential runs");
const runs = input.runs.map((run) => {
	const doc = new LoroDoc();
	doc.setPeerId("17");
	doc.setRecordTimestamp(false);
	if (run.snapshot) doc.import(Uint8Array.from(run.snapshot));
	const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });
	const observations = [];
	for (const state of run.states) {
		mirror.setState(state);
		observations.push(observe(doc));
	}
	if (run.updates) {
		for (const bytes of run.updates) doc.import(Uint8Array.from(bytes));
		observations.push(observe(doc));
	}
	const snapshot = [...doc.export({ mode: "snapshot" })];
	mirror.dispose();
	return { observations, snapshot };
});
console.log(JSON.stringify(runs));
