#!/usr/bin/env bun
// Local dev entry point — runs as a plain Bun HTTP server.
// Uses process.env + new Function (no QuickJS, no wrangler, no TLS issues).
import { Hono } from "hono";
import type { SerializedEditorState } from "lexical";
import { runAgent } from "../../lexical-core/ai-editing/agents/supervisor";
import {
	createEditingSession,
	loadSnapshot,
	toSnapshot,
} from "../../lexical-core/ai-editing/ai-toolkit";
import { realAwarenessSource } from "../../lexical-core/ai-editing/awareness/awareness-source";
import type { DocumentOp } from "../../lexical-core/ai-editing/editor/ops";
import { env } from "./env";
import { connectPeer } from "./peer";
import { childModel, supervisorModel } from "./providers";

const { SYNC_WS_BASE, PORT } = env;

const app = new Hono();

app.post("/edit", async (c) => {
	const body = await c.req.json<{
		token?: string;
		documentId?: string;
		prompt?: string;
	}>();
	const { token, documentId, prompt } = body;

	if (!token || !documentId || !prompt) {
		return c.json({ error: "token, documentId, and prompt are required" }, 400);
	}

	const signal = c.req.raw.signal;
	const wsUrl = `${SYNC_WS_BASE}/document/${documentId}/connect?token=${token}`;

	let peer: Awaited<ReturnType<typeof connectPeer>>;
	try {
		peer = await connectPeer(wsUrl, signal);
	} catch (err) {
		return c.json(
			{ error: err instanceof Error ? err.message : String(err) },
			502,
		);
	}
	const { doc, mirror, peerPool, sendAwareness, disconnect } = peer;

	try {
		const session = createEditingSession();
		loadSnapshot(session, mirror.getState() as SerializedEditorState);

		// One loro touch per edit. setState applies + commits internally (origin
		// 'to-loro'), which fires the peer's subscribeLocalUpdates → WS push. The
		// extra mirror.sync()/doc.commit() were redundant same-tick touches that
		// re-acquired loro's handler lock and tripped the locking-order panic.
		//
		// Before each commit, rotate the doc's loro peer id through the pool so every
		// applied edit is attributed to a distinct peer (bounded by the pool size),
		// making the AI's edits read as several collaborators in the doc's history.
		// `commit()` first flushes any stray pending ops to the prior peer so the
		// switch only affects the upcoming edit's change (loro requires a clean state
		// to reattribute). This is synchronous and serial — the single shared doc
		// commits one edit at a time, which is the semaphore in action.
		const propagate = () => {
			const peer = peerPool.rotate();
			if (peer !== undefined) {
				doc.commit();
				doc.setPeerId(peer);
			}
			const aiSnapshot = toSnapshot(session) as never;
			const mirrorState = mirror.getState() as Record<string, unknown>;
			const aiState = aiSnapshot as Record<string, unknown>;
			console.log(
				`[propagate] mirror.state keys=${Object.keys(mirrorState).join(",")} ai.state keys=${Object.keys(aiState).join(",")}`
			);
			const mirrorText = JSON.stringify(mirrorState).length;
			const aiText = JSON.stringify(aiState).length;
			console.log(
				`[propagate] mirror.state size=${mirrorText} ai.snapshot size=${aiText} delta=${aiText - mirrorText}`
			);
			mirror.setState(aiSnapshot);
		};

		const allOps: DocumentOp[] = [];

		const { text: summary, totalUsage } = await runAgent(session, prompt, supervisorModel, {
			propagate,
			makeAwareness: (name, color) =>
				realAwarenessSource({ mirror, doc, send: sendAwareness, name, color }),
			childModel,
			signal,
			onOps: (ops) => allOps.push(...ops),
			// defaultCodeRunner (new Function) is used — works fine in bun
		});

		return c.json({ ok: true, summary, usage: totalUsage, ops: allOps });
	} finally {
		disconnect();
	}
});

console.log(`AI editing server running on http://localhost:${PORT}`);
export default { port: PORT, fetch: app.fetch };
