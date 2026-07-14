#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { renderTraceMarkdown, type TraceSession } from "../src/trace-log";

const WORKER_URL_BY_ENV: Record<string, string> = {
	local: "http://localhost:8933",
	dev: "https://ai-editing-worker-dev.macroverse.workers.dev",
	playground: "https://ai-editing-worker-playground.macroverse.workers.dev",
	prod: "https://ai-editing-worker.macroverse.workers.dev",
};

const { env, id, latest, json, "worker-url": workerUrlOpt, _ } =
	await yargs(hideBin(process.argv))
		.usage(
			"$0 <document-id> [--env dev] [--id <trace-id> | --latest] [--json] [--worker-url <url>]\n\n" +
				"Lists edit traces for a document; with --id/--latest dumps the full trace\n" +
				"(rendered markdown by default, or raw structured JSON with --json).\n\n" +
				"Auth: reads INTERNAL_API_KEY from the environment.",
		)
		.help()
		.option("env", {
			type: "string",
			default: "dev",
			choices: Object.keys(WORKER_URL_BY_ENV),
			describe: "worker environment",
		})
		.option("id", {
			type: "string",
			describe: "dump the full markdown for this trace id",
		})
		.option("latest", {
			type: "boolean",
			default: false,
			describe: "dump the full markdown for the newest trace of the document",
		})
		.option("worker-url", {
			type: "string",
			describe: "override the worker base URL",
		})
		.option("json", {
			type: "boolean",
			default: false,
			describe:
				"with --id/--latest, emit the raw structured JSON instead of rendered markdown",
		})
		.parse();

const documentId = _[0] as string | undefined;
if (!documentId) {
	console.error(
		"Usage: bun run scripts/traces.ts <document-id> [--env dev] [--id <trace-id> | --latest]",
	);
	process.exit(1);
}

const apiKey = process.env.INTERNAL_API_KEY;
if (!apiKey) {
	console.error("INTERNAL_API_KEY env var is not set");
	process.exit(1);
}

const workerBase = workerUrlOpt ?? WORKER_URL_BY_ENV[env]!;

const res = await fetch(`${workerBase}/traces/${documentId}`, {
	headers: { "x-internal-auth-key": apiKey },
});
if (!res.ok) {
	console.error(`${res.status} ${res.statusText}: ${await res.text()}`);
	process.exit(1);
}

const { traces } = (await res.json()) as {
	documentId: string;
	count: number;
	traces: { id: string; createdAt: number; session: TraceSession }[];
};

if (id || latest) {
	const trace = id
		? traces.find((t) => t.id === id)
		: traces[0];
	if (!trace) {
		console.error("no matching trace");
		process.exit(1);
	}
	if (json) {
		process.stdout.write(JSON.stringify(trace.session, null, 2));
	} else {
		process.stdout.write(renderTraceMarkdown(trace.session));
	}
} else {
	if (traces.length === 0) {
		console.error("no traces for that document");
		process.exit(1);
	}
	console.table(
		traces.map((t) => ({
			id: t.id,
			at_utc: new Date(t.createdAt).toISOString(),
			json_chars: JSON.stringify(t.session).length,
		})),
	);
}
