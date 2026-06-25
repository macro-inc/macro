#!/usr/bin/env bun
import { args } from "./utils";

const {
	port,
	"worker-url": workerUrlOpt,
	"user-token": userToken,
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
	"$0 <document-id> <prompt>",
	(y) =>
		y
			.option("user-token", { type: "string", demandOption: true, describe: "user JWT or full browser cookie string" })
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

const documentId = _[0] as string | undefined;
const prompt = _[1] as string | undefined;
if (!documentId || !prompt) {
	console.error("Usage: bun run scripts/edit.ts <document-id> <prompt> --user-token <jwt>");
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

const resolvedToken = (userToken as string).includes("=")
	? Object.fromEntries(
			(userToken as string).split(";").map((p) => p.trim().split(/=(.+)/)).filter((p) => p.length >= 2).map(([k, v]) => [k!.trim(), v!.trim()])
		)["local-macro-access-token"] ?? (() => { console.error("local-macro-access-token not found in cookie"); process.exit(1); })()
	: userToken as string;

const controller = new AbortController();

const res = await fetch(`${workerUrl}/edit`, {
	method: "POST",
	signal: controller.signal,
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		userToken: resolvedToken,
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
