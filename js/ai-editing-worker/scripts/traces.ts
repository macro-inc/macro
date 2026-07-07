#!/usr/bin/env bun
import { $ } from "bun";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { renderTraceMarkdown, type TraceSession } from "../src/trace-log";

// Each env has its own D1 database (see wrangler.toml).
const DB_BY_ENV: Record<string, string> = {
	local: "ai-editing-traces",
	dev: "ai-editing-traces",
	playground: "ai-editing-traces-playground",
	prod: "ai-editing-traces-prod",
};

const { env, id, latest, local, json, _ } = await yargs(hideBin(process.argv))
	.usage(
		"$0 <document-id> [--env dev] [--id <trace-id> | --latest] [--json] [--local]\n\n" +
			"Lists edit traces for a document; with --id/--latest dumps the full trace\n" +
			"(rendered markdown by default, or raw structured JSON with --json).",
	)
	.help()
	.option("env", {
		type: "string",
		default: "dev",
		choices: Object.keys(DB_BY_ENV),
		describe: "worker environment (selects the D1 database)",
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
	.option("local", {
		type: "boolean",
		default: false,
		describe: "query the local dev shard instead of the remote database",
	})
	.option("json", {
		type: "boolean",
		default: false,
		describe:
			"with --id/--latest, emit the raw structured JSON instead of rendered markdown",
	})
	.parse();

const documentId = _[0] as string | undefined;
if (!documentId && !id) {
	console.error(
		"Usage: bun run scripts/traces.ts <document-id> [--env dev] [--id <trace-id> | --latest]",
	);
	process.exit(1);
}

const db = DB_BY_ENV[env]!;
const location = local ? [] : ["--remote"];

// Guard against breaking out of the SQL string literal. Ids are uuids / doc ids.
function lit(value: string): string {
	if (value.includes("'")) {
		console.error(`invalid identifier: ${value}`);
		process.exit(1);
	}
	return `'${value}'`;
}

async function query(sql: string): Promise<Record<string, unknown>[]> {
	const res =
		await $`bunx wrangler d1 execute ${db} --env ${env} ${location} --json --command ${sql}`.quiet();
	const parsed = JSON.parse(res.stdout.toString()) as [{ results: unknown[] }];
	return parsed[0].results as Record<string, unknown>[];
}

if (id || latest) {
	const where = id
		? `id = ${lit(id)}`
		: `document_id = ${lit(documentId!)} ORDER BY created_at DESC LIMIT 1`;
	const rows = await query(`SELECT trace_json FROM edit_traces WHERE ${where}`);
	if (rows.length === 0) {
		console.error("no matching trace");
		process.exit(1);
	}
	const raw = String(rows[0]!.trace_json);
	if (json) {
		process.stdout.write(raw);
	} else {
		process.stdout.write(
			renderTraceMarkdown(JSON.parse(raw) as TraceSession),
		);
	}
} else {
	const rows = await query(
		`SELECT id, datetime(created_at/1000,'unixepoch') AS at_utc, length(markdown) AS md_chars FROM edit_traces WHERE document_id = ${lit(documentId!)} ORDER BY created_at DESC`,
	);
	if (rows.length === 0) {
		console.error("no traces for that document");
		process.exit(1);
	}
	console.table(rows);
}
