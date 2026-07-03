#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const {
	port,
	"worker-url": workerUrlOpt,
	"ws-url": wsUrl,
	"supervisor-model": supervisorModelFlag,
	"interpret-model": interpretModelFlag,
	"coding-model": codingModelFlag,
	debug,
	out,
	"prompt-file": promptFile,
	_,
} = await yargs(hideBin(process.argv))
	.usage("$0 [prompt] --ws-url <url>")
	.help()
	.option("ws-url", { type: "string", demandOption: true, describe: "sync service ws url with token, e.g. wss://…/document/<id>/connect?token=<doc-token>" })
	.option("port", { type: "number", default: 8933, describe: "worker port" })
	.option("worker-url", { type: "string", describe: "full worker base URL (overrides --port)" })
	.option("supervisor-model", { type: "string", demandOption: true, describe: "provider:model for the supervisor" })
	.option("interpret-model", { type: "string", demandOption: true, describe: "provider:model for the interpret pass" })
	.option("coding-model", { type: "string", demandOption: true, describe: "provider:model for the coding agents" })
	.option("debug", { type: "boolean", default: false, describe: "include the supervisor step trace + replay trace in the response" })
	.option("out", { type: "string", describe: "write the replay trace JSON to this file (implies --debug)" })
	.option("prompt-file", { type: "string", describe: "read the prompt from this file instead of the positional arg" })
	.parse();

const prompt = promptFile
	? (await Bun.file(promptFile as string).text()).trim()
	: (_[0] as string | undefined);
if (!prompt) {
	console.error("Usage: bun run scripts/edit.ts [prompt] --ws-url <url>  (or pass --prompt-file <path>)");
	process.exit(1);
}

const parsed = new URL(wsUrl as string);
const pathParts = parsed.pathname.split("/");
const documentId = pathParts[2];
const documentToken = parsed.searchParams.get("token");
if (!documentId || !documentToken) {
	console.error("--ws-url must be in the form wss://…/document/<id>/connect?token=<doc-token>");
	process.exit(1);
}

const parseModel = (flag: string) => {
	const [provider, model] = flag.split(":");
	return { provider: provider!, model: model! };
};

const workerUrl = workerUrlOpt ?? `http://localhost:${port}`;

const controller = new AbortController();
process.on("SIGINT", () => {
	console.error("\naborting request…");
	controller.abort();
});
const wantDebug = debug || Boolean(out);

const res = await fetch(`${workerUrl}/edit`, {
	method: "POST",
	signal: controller.signal,
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		documentToken,
		documentId,
		prompt,
		models: {
			supervisor: parseModel(supervisorModelFlag),
			interpret: parseModel(interpretModelFlag),
			coding: parseModel(codingModelFlag),
		},
		debug: wantDebug,
	}),
	timeout: false,
} as RequestInit & { timeout: boolean }).catch((err) => {
	if (controller.signal.aborted) process.exit(130);
	throw err;
});

const body = (await res.json()) as {
	trace?: string;
	replay?: unknown;
} & Record<string, unknown>;

if (out && body.replay) {
	await Bun.write(out, JSON.stringify(body.replay));
	const events = (body.replay as { events?: unknown[] }).events ?? [];
	console.log(`wrote replay trace to ${out} (${events.length} events)`);
}

if (wantDebug && body.trace) {
	console.log(body.trace);
	const { trace, replay, ...rest } = body;
	console.log("\n---\n");
	console.log(rest);
} else {
	const { replay, ...rest } = body;
	console.log(rest);
}
