#!/usr/bin/env bun
import { args, parseWssUrl } from "./utils";

const {
	wssUrl,
	port,
	"worker-url": workerUrlOpt,
	provider,
	"supervisor-provider": supervisorProvider,
	"interpret-provider": interpretProvider,
	"coding-provider": codingProvider,
	"supervisor-model": supervisorModel,
	"interpret-model": interpretModel,
	"coding-model": codingModel,
	debug,
	_,
} = await args(
	"$0 <wss-url> <prompt>",
	(y) =>
		y
			.option("port", { type: "number", default: 8933, describe: "worker port" })
			.option("worker-url", { type: "string", describe: "full worker base URL (overrides --port)" })
			.option("provider", { type: "string", default: "anthropic", describe: "default provider for all roles: anthropic, cerebras, openai" })
			.option("supervisor-provider", { type: "string", describe: "provider for the supervisor agent (overrides --provider)" })
			.option("interpret-provider", { type: "string", describe: "provider for the interpret pass (overrides --provider)" })
			.option("coding-provider", { type: "string", describe: "provider for the coding agents (overrides --provider)" })
			.option("supervisor-model", { type: "string", describe: "model ID for the supervisor agent" })
			.option("interpret-model", { type: "string", describe: "model ID for the interpret pass" })
			.option("coding-model", { type: "string", describe: "model ID for the coding (writer) agents" })
			.option("debug", { type: "boolean", default: false, describe: "include the supervisor step trace in the response" }),
);

const prompt = _[1] as string | undefined;
if (!prompt) {
	console.error("Usage: bun run scripts/edit.ts <wss-url> <prompt> [--port 8933]");
	process.exit(1);
}

const DEFAULT_MODELS: Record<string, string> = {
	anthropic: "claude-sonnet-4-6",
	cerebras: "gpt-oss-120b",
	openai: "gpt-4o",
};

const makeModel = (modelId: string | undefined, roleProvider: string) => ({
	provider: roleProvider,
	model: modelId ?? DEFAULT_MODELS[roleProvider] ?? "claude-sonnet-4-6",
});

const workerUrl = workerUrlOpt ?? `http://localhost:${port}`;
const { documentId, token } = parseWssUrl(wssUrl);

const res = await fetch(`${workerUrl}/edit`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		token,
		documentId,
		prompt,
		models: {
			supervisor: makeModel(supervisorModel as string | undefined, (supervisorProvider ?? provider) as string),
			interpret: makeModel(interpretModel as string | undefined, (interpretProvider ?? provider) as string),
			coding: makeModel(codingModel as string | undefined, (codingProvider ?? provider) as string),
		},
		debug,
	}),
});

const body = (await res.json()) as { trace?: string } & Record<string, unknown>;

if (debug && body.trace) {
	console.log(body.trace);
	const { trace, ...rest } = body;
	console.log("\n---\n");
	console.log(rest);
} else {
	console.log(body);
}
