import "./globals";
import { createAnthropic } from "@ai-sdk/anthropic";
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
import { connectPeer } from "./peer";
import { runInSandbox } from "./sandbox";

type Bindings = {
	ANTHROPIC_API_KEY: string;
	SYNC_WS_BASE: string;
};

const app = new Hono<{ Bindings: Bindings }>();

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
	const wsUrl = `${c.env.SYNC_WS_BASE}/document/${documentId}/connect?token=${token}`;
	const model = createAnthropic({ apiKey: c.env.ANTHROPIC_API_KEY })(
		"claude-sonnet-4-6",
	);

	const { doc, mirror, peerPool, sendAwareness, disconnect } =
		await connectPeer(wsUrl, signal);

	try {
		const session = createEditingSession();
		loadSnapshot(session, mirror.getState() as SerializedEditorState);

		// Rotate the peer id before each commit so edits are attributed to distinct
		// peers in the bounded pool. mirror.setState commits internally via 'to-loro'
		// origin — no extra sync()/commit() needed (those caused locking violations).
		const propagate = () => {
			const peer = peerPool.rotate();
			if (peer !== undefined) {
				doc.commit();
				doc.setPeerId(peer);
			}
			mirror.setState(toSnapshot(session) as never);
		};

		const allOps: DocumentOp[] = [];

		const { totalUsage } = await runAgent(session, prompt, model, {
			propagate,
			makeAwareness: (name, color) =>
				realAwarenessSource({ mirror, doc, send: sendAwareness, name, color }),
			signal,
			runner: runInSandbox,
			onOps: (ops) => allOps.push(...ops),
		});

		return c.json({ ok: true, usage: totalUsage, ops: allOps });
	} finally {
		disconnect();
	}
});

export default app;
