// No Source model or test body runs here; the product builds its own native DOM tree.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

export function serializeHtml(root, nodes) {
	const require = createRequire(
		`${root}/packages/lexical-conformance/package.json`,
	);
	const { JSDOM } = require("jsdom");
	const { serializeClipboardDom } = require(
		`${root}/packages/lexical-wasm-view/src/view/clipboard-dom.ts`,
	);
	const dom = new JSDOM();
	try {
		return serializeClipboardDom(
			{ plain: "", lexical: "", nodes: JSON.parse(nodes) },
			dom.window.document,
		).html;
	} finally {
		dom.window.close();
	}
}

if (import.meta.main) {
	const { root, nodes } = JSON.parse(readFileSync(0, "utf8"));
	process.stdout.write(serializeHtml(root, nodes));
}
