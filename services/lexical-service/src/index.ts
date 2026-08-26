import "./polyfills/prism";

import { fromHono } from "chanfana";
import { Hono, type MiddlewareHandler } from "hono";
import { AgentAnnouncementEndpoint } from "./endpoints/agent-announcement";
import { AgentContextEndpoint } from "./endpoints/agent-context";
import { CognitionPresignedEndpoint } from "./endpoints/cognition-presigned";
import { CognitionTextEndpoint } from "./endpoints/cognition-text";
import { CognitionV2Endpoint } from "./endpoints/cognition-v2";
import { MarkdownEndpoint } from "./endpoints/markdown";
import { MarkdownSnapshotEndpoint } from "./endpoints/markdown-snapshot";
import { MentionsEndpoint } from "./endpoints/mentions";
import { PlaintextEndpoint } from "./endpoints/plaintext";
import { QuoteReplyEndpoint } from "./endpoints/quote-reply";
import { SearchTextEndpoint } from "./endpoints/search-text";
import { XmlEndpoint } from "./endpoints/xml";

type Bindings = {
	INTERNAL_AUTH_KEY: string;
	SYNC_SERVICE_AUTH_KEY: string;
	SYNC_SERVICE_URL: string;
	SYNC_SERVICE: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

// Apply internal auth middleware only to API endpoints
const internalAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (
	c,
	next,
) => {
	const authKey = c.req.header("x-internal-auth-key");
	if (!authKey || authKey !== c.env.INTERNAL_AUTH_KEY) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
};

app.use("/plaintext/*", internalAuth);
app.use("/cognition/*", internalAuth);
app.use("/cognitionv2/*", internalAuth);
app.use("/search/*", internalAuth);
app.use("/xml/*", internalAuth);
app.use("/markdown/*", internalAuth);
app.use("/snapshot/*", internalAuth);
app.use("/mentions", internalAuth);
app.use("/quote-reply", internalAuth);
app.use("/agent-announcement", internalAuth);
app.use("/agent-context", internalAuth);
app.use("/internal/health", internalAuth);

const openapi = fromHono(app, {
	docs_url: "/",
	schema: {
		info: {
			title: "Lexical Service API",
			version: "1.0.0",
			description: "API for converting Lexical documents to various formats",
		},
	},
});

openapi.get("/health", (c) => c.json({ message: "Healthy" }));
openapi.get("/plaintext/:docId", PlaintextEndpoint);
openapi.get("/cognition/presigned", CognitionPresignedEndpoint);
openapi.get("/cognition/:docId", CognitionTextEndpoint);
openapi.get("/cognitionv2/:docId", CognitionV2Endpoint);
openapi.get("/search/:docId", SearchTextEndpoint);
openapi.get("/markdown/:docId", MarkdownEndpoint);
openapi.get("/xml/:docId", XmlEndpoint);
openapi.post("/snapshot/markdown", MarkdownSnapshotEndpoint);
openapi.post("/mentions", MentionsEndpoint);
openapi.post("/quote-reply", QuoteReplyEndpoint);
openapi.post("/agent-announcement", AgentAnnouncementEndpoint);
openapi.post("/agent-context", AgentContextEndpoint);
openapi.get("/internal/health", (c) => c.json({ status: "healthy" }));

export default app;
