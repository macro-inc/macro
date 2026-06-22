import "../src/globals";
import { args } from "./utils";
import { LoroDoc } from "loro-crdt";
import { $getRoot, $isElementNode, $isTextNode, type LexicalNode } from "lexical";
import type { SerializedEditorState } from "lexical";
import {
	FromPeer,
	FromRemote,
} from "../../app/packages/service-clients/service-sync/generated/schema";
import { createEditingSession, loadSnapshot } from "../../lexical-core/ai-editing/ai-toolkit";
import { $getId } from "../../lexical-core/plugins/nodeIdPlugin";
import { MARKDOWN_LORO_SCHEMA } from "../../lexical-core/markdown-loro-schema";
import { Mirror } from "../../loro-mirror/packages/core/src";

const { wssUrl: wsUrl } = await args("$0 <wss-url>");

const loroDoc = new LoroDoc();
const mirror = new Mirror({ doc: loroDoc, schema: MARKDOWN_LORO_SCHEMA });
const session = createEditingSession();

function reload() {
	loadSnapshot(session, mirror.getState() as SerializedEditorState);
}

function treeStr(): string {
	return session.editor.getEditorState().read(() => {
		const lines: string[] = [];
		function walk(node: LexicalNode, depth: number) {
			const indent = "  ".repeat(depth);
			const id = $getId(node);
			const idStr = id ? ` [${id}]` : "";
			if ($isTextNode(node)) {
				const fmt = node.getFormat();
				const fmtStr = fmt ? ` fmt=${fmt}` : "";
				lines.push(`${indent}text${idStr}${fmtStr} ${JSON.stringify(node.getTextContent())}`);
			} else if ($isElementNode(node)) {
				lines.push(`${indent}${node.getType()}${idStr}`);
				for (const child of node.getChildren()) walk(child, depth + 1);
			} else {
				lines.push(`${indent}${node.getType()}${idStr}`);
			}
		}
		walk($getRoot(), 0);
		return lines.join("\n");
	});
}

/** Show only the part of `next` that differs from `prev`, with 3 lines of context. */
function diff(prev: string, next: string): string {
	const prevLines = prev.split("\n");
	const nextLines = next.split("\n");
	const out: string[] = [];
	const CTX = 3;
	let lastPrinted = -1;
	for (let i = 0; i < nextLines.length; i++) {
		if (nextLines[i] !== prevLines[i]) {
			const from = Math.max(0, i - CTX);
			if (from > lastPrinted + 1) out.push("  ···");
			for (let c = Math.max(lastPrinted + 1, from); c < i; c++) {
				out.push(`   ${nextLines[c]}`);
			}
			const marker = i >= prevLines.length ? "+" : "~";
			out.push(`${marker}  ${nextLines[i]}`);
			lastPrinted = i;
		}
	}
	// lines removed from prev
	for (let i = nextLines.length; i < prevLines.length; i++) {
		out.push(`-  ${prevLines[i]}`);
	}
	return out.join("\n");
}

const ws = new WebSocket(wsUrl);
ws.binaryType = "arraybuffer";

let n = 0;
let prevTree = "";
const ts = () => new Date().toISOString().slice(11, 23);

ws.onopen = () => console.log(`[${ts()}] connected`);

ws.onmessage = (ev) => {
	if (typeof ev.data === "string") {
		if (ev.data === "ping") ws.send("pong");
		else console.log(`[${ts()}] text: ${ev.data}`);
		return;
	}

	n++;
	const bytes = new Uint8Array(ev.data as ArrayBuffer);
	let msg: FromRemote;
	try {
		msg = FromRemote.decode(bytes);
	} catch {
		console.log(`[${ts()}] #${n} unparseable (${bytes.byteLength}B)`);
		return;
	}

	if (msg.isRemoteInitialSync()) {
		const { snapshot } = msg.value as { snapshot: Uint8Array };
		loroDoc.import(snapshot);
		reload();
		prevTree = treeStr();
		console.log(`[${ts()}] #${n} initial-sync ${snapshot.byteLength}B`);
		console.log(prevTree);
		ws.send(
			FromPeer.encode(
				FromPeer.fromPeerRegisterId({
					peerid: loroDoc.peerId as unknown as bigint,
				}),
			),
		);
	} else if (msg.isRemoteUpdate()) {
		const { update } = msg.value as { update: Uint8Array };
		loroDoc.import(update);
		reload();
		const tree = treeStr();
		const d = diff(prevTree, tree);
		console.log(`[${ts()}] #${n} update ${update.byteLength}B`);
		if (d) console.log(d);
		prevTree = tree;
	} else if (msg.isRemoteAwareness()) {
		console.log(`[${ts()}] #${n} awareness ${(msg.value as { awareness: Uint8Array }).awareness.byteLength}B`);
	} else {
		console.log(`[${ts()}] #${n} unknown`);
	}
};

ws.onerror = () => console.error(`[${ts()}] error`);
ws.onclose = (ev) => console.log(`[${ts()}] closed ${ev.code} ${ev.reason}`);

process.on("SIGINT", () => {
	ws.close(1000, "done");
	process.exit(0);
});
