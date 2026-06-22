#!/usr/bin/env bun
import { args, parseWssUrl } from "./utils";

const { wssUrl, port, "worker-url": workerUrlOpt, _ } = await args(
	"$0 <wss-url> <prompt>",
	(y) =>
		y
			.option("port", { type: "number", default: 8933, describe: "worker port" })
			.option("worker-url", { type: "string", describe: "full worker base URL (overrides --port)" }),
);

const prompt = _[1] as string | undefined;
if (!prompt) {
	console.error("Usage: bun run scripts/edit.ts <wss-url> <prompt> [--port 8933]");
	process.exit(1);
}

const workerUrl = workerUrlOpt ?? `http://localhost:${port}`;
const { documentId, token } = parseWssUrl(wssUrl);

const res = await fetch(`${workerUrl}/edit`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ token, documentId, prompt }),
});

console.log(await res.json());
