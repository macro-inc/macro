#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const {
	port,
	"worker-url": workerUrlOpt,
	"user-token": userToken,
	"supervisor-model": supervisorModelFlag,
	"interpret-model": interpretModelFlag,
	"coding-model": codingModelFlag,
	debug,
	_,
} = await yargs(hideBin(process.argv))
	.usage("$0 <document-id> <prompt>")
	.help()
	.option("user-token", { type: "string", demandOption: true, describe: "user JWT or full browser cookie string" })
	.option("port", { type: "number", default: 8933, describe: "worker port" })
	.option("worker-url", { type: "string", describe: "full worker base URL (overrides --port)" })
	.option("supervisor-model", { type: "string", demandOption: true, describe: "provider:model for the supervisor" })
	.option("interpret-model", { type: "string", demandOption: true, describe: "provider:model for the interpret pass" })
	.option("coding-model", { type: "string", demandOption: true, describe: "provider:model for the coding agents" })
	.option("debug", { type: "boolean", default: false, describe: "include the supervisor step trace in the response" })
	.parse();

const documentId = _[0] as string | undefined;
const prompt = _[1] as string | undefined;
if (!documentId || !prompt) {
	console.error("Usage: bun run scripts/edit.ts <document-id> <prompt> --user-token <jwt>");
	process.exit(1);
}

const parseModel = (flag: string) => {
	const [provider, model] = flag.split(":");
	return { provider: provider!, model: model! };
};

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
			supervisor: parseModel(supervisorModelFlag),
			interpret: parseModel(interpretModelFlag),
			coding: parseModel(codingModelFlag),
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
