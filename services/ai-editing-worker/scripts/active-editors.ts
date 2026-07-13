#!/usr/bin/env bun
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const {
	token,
	"sync-base": syncBase,
	"include-ai": includeAi,
	_,
} = await yargs(hideBin(process.argv))
	.usage("$0 <document-id> --token <doc-permission-token>")
	.help()
	.option("token", {
		type: "string",
		demandOption: true,
		describe: "document permission JWT (sent as the Bearer token)",
	})
	.option("sync-base", {
		type: "string",
		default: "http://localhost:8787",
		describe: "sync service base URL",
	})
	.option("include-ai", {
		type: "boolean",
		default: false,
		describe: "include AI editor peers in the result",
	})
	.parse();

const documentId = _[0] as string | undefined;
if (!documentId) {
	console.error(
		"Usage: bun run scripts/active-editors.ts <document-id> --token <doc-permission-token>",
	);
	process.exit(1);
}

const url = `${syncBase}/document/${documentId}/active_peers?include_ai=${includeAi}`;
const res = await fetch(url, {
	headers: { Authorization: `Bearer ${token}` },
});

if (!res.ok) {
	console.error(`${res.status} ${res.statusText}: ${await res.text()}`);
	process.exit(1);
}

const peerIds = (await res.json()) as string[];
console.log(JSON.stringify(peerIds, null, 2));
