#!/usr/bin/env bun
/**
 * Interactively walk a Loro document's revision history.
 *
 *   bun run scripts/walk-loro.ts <file.loro>
 *   bun run scripts/walk-loro.ts "wss://sync-service-prod2.../document/<id>/connect?token=<jwt>"
 *
 * Arrow keys: ← / → jump between grouped sessions, ↑ / ↓ step individual changes.
 * q / Ctrl-C to quit.
 */
import { readFileSync } from "fs";
import { LoroDoc, type Change } from "loro-crdt";

// ── load ─────────────────────────────────────────────────────────────────────

async function loadSnapshot(): Promise<Uint8Array> {
	const arg = process.argv[2];
	if (!arg) {
		console.error(
			"Usage: bun run scripts/walk-loro.ts <file.loro | wss-url>",
		);
		process.exit(1);
	}
	if (arg.startsWith("wss://") || arg.startsWith("ws://")) {
		const parsed = new URL(arg);
		const token = parsed.searchParams.get("token");
		const docMatch = parsed.pathname.match(/\/document\/([^/]+)\/connect/);
		if (!token || !docMatch) {
			console.error("could not parse token or document id from url");
			process.exit(1);
		}
		const syncBase = `https://${parsed.host}`;
		const res = await fetch(
			`${syncBase}/document/${docMatch[1]}/snapshot`,
			{ headers: { Authorization: `Bearer ${token}` } },
		);
		if (!res.ok) {
			console.error(`snapshot fetch failed: ${res.status} ${res.statusText}`);
			process.exit(1);
		}
		return new Uint8Array(await res.arrayBuffer());
	}
	return readFileSync(arg);
}

// ── revision indexing ─────────────────────────────────────────────────────────

type Rev = {
	changes: Change[];
	frontiers: { peer: bigint; counter: number }[];
	timestamp: number; // ms
	label: string;
};

/** Build an antichain frontier up to and including the given change set. */
function frontiersThrough(sorted: Change[], upToIdx: number) {
	const frontier = new Map<bigint, number>();
	for (let i = 0; i <= upToIdx; i++) {
		const { peer, counter, length, deps } = sorted[i]!;
		const end = counter + length - 1;
		for (const dep of deps) {
			const cur = frontier.get(dep.peer);
			if (cur !== undefined && cur <= dep.counter) frontier.delete(dep.peer);
		}
		if (end > (frontier.get(peer) ?? -1)) frontier.set(peer, end);
	}
	return [...frontier.entries()].map(([peer, counter]) => ({ peer, counter }));
}

function buildRevisions(doc: LoroDoc, groupMs = 3000): Rev[] {
	const sorted = [...doc.getAllChanges().values()]
		.flat()
		.sort((a, b) => a.timestamp - b.timestamp || a.counter - b.counter);

	if (sorted.length === 0) return [];

	// Group into sessions separated by pauses > groupMs
	const revs: Rev[] = [];
	let group: Change[] = [sorted[0]!];

	const flush = (upToIdx: number) => {
		const frontiers = frontiersThrough(sorted, upToIdx);
		const ts = group[group.length - 1]!.timestamp * 1000;
		const nOps = group.reduce((s, c) => s + c.length, 0);
		revs.push({
			changes: [...group],
			frontiers,
			timestamp: ts,
			label: `${new Date(ts).toLocaleString()}  (${group.length} change${group.length !== 1 ? "s" : ""}, ${nOps} op${nOps !== 1 ? "s" : ""})`,
		});
	};

	for (let i = 1; i < sorted.length; i++) {
		const gap =
			(sorted[i]!.timestamp - sorted[i - 1]!.timestamp) * 1000;
		if (gap > groupMs) {
			flush(i - 1);
			group = [];
		}
		group.push(sorted[i]!);
	}
	flush(sorted.length - 1);
	return revs;
}

// ── text rendering ─────────────────────────────────────────────────────────────

type LexNode = {
	type?: string;
	text?: string;
	children?: LexNode[];
	listType?: string;
	$?: unknown;
};

function nodeText(node: LexNode, indent = 0): string {
	if (node.type === "text") return node.text ?? "";
	const children = (node.children ?? []).map((c) => nodeText(c, indent + 1));
	const gap = node.type === "paragraph" || node.type === "heading" ? "\n" : "";
	const bullet =
		node.type === "listitem" ? "  ".repeat(indent) + "• " : "";
	return bullet + children.join("") + gap;
}

function renderState(state: unknown): string {
	const root = (state as { root?: LexNode }).root;
	if (!root) return "(empty)";
	const lines = (root.children ?? []).map((c) => nodeText(c)).join("\n");
	return lines.trim() || "(empty)";
}

// ── terminal UI ───────────────────────────────────────────────────────────────

const ESC = "\x1b";
const CLEAR = `${ESC}[2J${ESC}[H`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RESET = `${ESC}[0m`;
const CYAN = `${ESC}[36m`;
const YELLOW = `${ESC}[33m`;

function render(
	doc: LoroDoc,
	revs: Rev[],
	idx: number,
	totalChanges: number,
) {
	const rev = revs[idx]!;
	doc.checkoutToLatest();
	doc.checkout(rev.frontiers);
	const state = doc.toJSON();
	const text = renderState(state);

	const cols = process.stdout.columns ?? 80;
	const bar = "─".repeat(cols);

	process.stdout.write(CLEAR);
	process.stdout.write(
		`${BOLD}${CYAN}Revision ${idx + 1} / ${revs.length}${RESET}  ${DIM}(${totalChanges} raw changes total)${RESET}\n`,
	);
	process.stdout.write(`${YELLOW}${rev.label}${RESET}\n`);
	process.stdout.write(`${DIM}${bar}${RESET}\n`);
	process.stdout.write(text + "\n");
	process.stdout.write(`${DIM}${bar}${RESET}\n`);
	process.stdout.write(
		`${DIM}← → jump sessions  ↑ ↓ step changes  q quit${RESET}\n`,
	);
}

// ── main ──────────────────────────────────────────────────────────────────────

const bytes = await loadSnapshot();
const doc = new LoroDoc();
doc.import(bytes);

const revs = buildRevisions(doc);
if (revs.length === 0) {
	console.error("no revisions found in document");
	process.exit(1);
}

// Also build a per-change index for fine-grained stepping
const allChanges = [...doc.getAllChanges().values()]
	.flat()
	.sort((a, b) => a.timestamp - b.timestamp || a.counter - b.counter);

// Map each fine-grained change index → rev index
const changeToRev = allChanges.map((_, ci) => {
	// Find which rev this change belongs to (last rev whose first change index ≤ ci)
	let lo = 0, hi = revs.length - 1;
	// revs are built in order so each rev's changes are a contiguous slice
	let offset = 0;
	for (let r = 0; r < revs.length; r++) {
		if (ci < offset + revs[r]!.changes.length) return r;
		offset += revs[r]!.changes.length;
	}
	return revs.length - 1;
});

// Fine-grained revisions (one per change) for ↑↓
const fineRevs: Rev[] = allChanges.map((_, ci) => {
	const frontiers = frontiersThrough(allChanges, ci);
	const ts = allChanges[ci]!.timestamp * 1000;
	return {
		changes: [allChanges[ci]!],
		frontiers,
		timestamp: ts,
		label: `${new Date(ts).toLocaleString()}  (change ${ci + 1} / ${allChanges.length})`,
	};
});

let mode: "session" | "change" = "session";
let sessionIdx = revs.length - 1;
let changeIdx = allChanges.length - 1;

function currentRevs() {
	return mode === "session" ? revs : fineRevs;
}
function currentIdx() {
	return mode === "session" ? sessionIdx : changeIdx;
}

render(
	doc,
	mode === "session" ? revs : fineRevs,
	currentIdx(),
	allChanges.length,
);

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", (buf) => {
	const key = buf.toString();

	if (key === "q" || key === "\x03" /* Ctrl-C */) {
		doc.checkoutToLatest();
		process.stdin.setRawMode(false);
		process.stdout.write(CLEAR);
		process.exit(0);
	}

	const prev = currentIdx();

	if (key === `${ESC}[C` /* right */ || key === `${ESC}[B` /* down */) {
		if (mode === "session") {
			sessionIdx = Math.min(sessionIdx + 1, revs.length - 1);
		} else {
			changeIdx = Math.min(changeIdx + 1, fineRevs.length - 1);
			sessionIdx = changeToRev[changeIdx] ?? revs.length - 1;
		}
	} else if (key === `${ESC}[D` /* left */ || key === `${ESC}[A` /* up */) {
		if (mode === "session") {
			sessionIdx = Math.max(sessionIdx - 1, 0);
		} else {
			changeIdx = Math.max(changeIdx - 1, 0);
			sessionIdx = changeToRev[changeIdx] ?? 0;
		}
	} else if (key === "\t") {
		// Tab toggles fine/coarse mode
		mode = mode === "session" ? "change" : "session";
		if (mode === "change") {
			// jump to the last change of the current session
			let offset = 0;
			for (let r = 0; r < sessionIdx; r++) offset += revs[r]!.changes.length;
			changeIdx = offset + revs[sessionIdx]!.changes.length - 1;
		}
	}

	render(
		doc,
		mode === "session" ? revs : fineRevs,
		currentIdx(),
		allChanges.length,
	);
});
