import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, test } from "vitest";
import { auditCorpusFiles } from "../scripts/audit-activated-transcripts.mjs";

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const path of temporaryDirectories.splice(0))
		rmSync(path, { recursive: true, force: true });
});

// Use an actual recorded unauthorized response with no storage transformation.
const fixture = readFileSync(
	new URL(
		"../../../crates/sync_server_sim/tests/transcripts/active_peers.test/active_peers_endpoint_tests_should_require_authentication_for_active_peers_endpoint.jsonl",
		import.meta.url,
	),
);

function directories() {
	const root = mkdtempSync(join(tmpdir(), "activation-gzip-"));
	temporaryDirectories.push(root);
	const before = join(root, "before");
	const after = join(root, "after");
	mkdirSync(before);
	mkdirSync(after);
	return { before, after };
}

test("activation audit includes gzip-only recordings under their logical names", () => {
	const { before, after } = directories();
	writeFileSync(join(before, "case.jsonl.gz"), gzipSync(fixture));
	writeFileSync(join(after, "case.jsonl.gz"), gzipSync(fixture));
	const result = auditCorpusFiles(before, after);
	expect(result.count).toBe(1);
	expect(result.fixtures[0].path).toBe("case.jsonl");
	expect(result.fixtures[0].equal).toBe(true);
	expect(result.fixtures[0].wireSha256).toMatch(/^[0-9a-f]{64}$/);
});

test("activation audit compares plain and compressed copies without changing proof", () => {
	const { before, after } = directories();
	writeFileSync(join(before, "case.jsonl"), fixture);
	writeFileSync(join(after, "case.jsonl"), fixture);
	const plain = auditCorpusFiles(before, after);
	rmSync(join(after, "case.jsonl"));
	writeFileSync(join(after, "case.jsonl.gz"), gzipSync(fixture));
	expect(auditCorpusFiles(before, after)).toEqual(plain);
});

test("activation audit rejects corruption after a valid compressed member", () => {
	const { before, after } = directories();
	writeFileSync(join(before, "case.jsonl.gz"), gzipSync(fixture));
	writeFileSync(
		join(after, "case.jsonl.gz"),
		Buffer.concat([gzipSync(fixture), gzipSync(fixture).subarray(0, 9)]),
	);
	expect(() => auditCorpusFiles(before, after)).toThrow();
});

test("activation audit rejects duplicate plain and gzip logical identities", () => {
	const { before, after } = directories();
	writeFileSync(join(before, "case.jsonl"), fixture);
	writeFileSync(join(before, "case.jsonl.gz"), gzipSync(fixture));
	writeFileSync(join(after, "case.jsonl"), fixture);
	expect(() => auditCorpusFiles(before, after)).toThrow();
});
