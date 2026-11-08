// Import the Rust example's snapshot using the sync-service's installed JS package.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(
	new URL("../../../../services/sync-service/package.json", import.meta.url),
);
const { LoroDoc } = require("loro-crdt");
const manifest = new URL(
	"../package.json",
	pathToFileURL(require.resolve("loro-crdt")),
);
assert.equal(JSON.parse(readFileSync(manifest, "utf8")).version, "1.17.1");
const doc = new LoroDoc();
if (process.argv.includes("--record")) {
	doc.setPeerId("2");
	doc.getText("text").insert(0, "snapshot Σ𐐀");
	console.log(JSON.stringify(Array.from(doc.export({ mode: "snapshot" }))));
} else {
	doc.import(Uint8Array.from(JSON.parse(readFileSync(0, "utf8"))));
	assert.deepEqual(doc.toJSON(), { text: "snapshot Σ𐐀" });
	console.log("Rust snapshot imports in loro-crdt 1.17.1 with identical state");
}
