// Record complete anchored match ranges and captures with the reference V8 engine.
import { readFileSync, writeFileSync } from "node:fs";

if (process.versions.node.split(".")[0] !== "24") {
	throw new Error("Use Node 24 for the anchored regex oracle");
}

const units = (text) =>
	Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));
const inputs = [
	"",
	"a",
	"b",
	"aaabbb",
	"prefix a",
	"a\nb",
	"\r\na\r\n",
	"\u2028a\u2029",
	"ΣσςſK",
	"\u1c89\u1c8a",
	"😀ab𐐀",
	"# heading",
	"  12. item",
	"<m-image>payload</m-image>",
	"before\n<m-image>payload</m-image>",
	"```text",
	"plain prose — “quoted”",
].map(units);
inputs.push([0xd800], [0xdc00], [0xd800, 0x61, 0xdc00], [0xd800, 0xdc00, 0x61]);

const expressions = new Map();
function add(source, flags) {
	expressions.set(JSON.stringify([source, flags]), { source, flags });
}
for (const source of [
	"^",
	"^$",
	"^(a*)",
	"^(a)?(b*)",
	"^(?<head>a*)(?<tail>b*)",
	"^a|^b",
	"(^a)|(^b)",
	"^a|b",
	"(?:^a)?b",
	"^|a",
	"a^b",
	"^(?=a)(a*)",
	"^(?!a)(.*)",
	"^(?<=a)b",
	"^(a*)\\1",
	"^(?:a|b)*",
	"^.*$",
	"^[^]*",
	"^\\w+",
	"^\\s*#",
	"^\\uD800",
	"^\\uDC00",
	"^\\u212a",
	"^\\u017f",
	"^\\u1c89",
	"^(.)",
	"^([\\s\\S]*?)(a)?$",
	"^[a-z]+",
	"[^]",
	"a*",
]) {
	for (const flags of [
		"",
		"i",
		"u",
		"iu",
		"m",
		"im",
		"mu",
		"s",
		"ms",
		"v",
		"iv",
	]) {
		add(source, flags);
	}
}
const catalog = JSON.parse(
	readFileSync(
		new URL(
			"../macro_document_model/src/transformers/catalog.json",
			import.meta.url,
		),
		"utf8",
	),
);
for (const entry of catalog.catalog) {
	for (const key of ["regExp", "importRegExp", "regExpStart", "regExpEnd"]) {
		const pattern = entry[key];
		if (pattern?.matcher === "RegExp" && pattern.source.includes("^")) {
			add(pattern.source, pattern.flags);
		}
	}
}

const cases = [];
for (const { source, flags } of expressions.values()) {
	for (const input of inputs) {
		const text = String.fromCharCode(...input);
		const regex = new RegExp(source, `${flags}dg`);
		const matches = [];
		for (;;) {
			const match = regex.exec(text);
			if (match === null) break;
			matches.push({
				ranges: Array.from(match.indices, (range) => range ?? null),
				captures: Array.from(match, (value) =>
					value === undefined ? null : units(value),
				),
				named: Object.entries(match.indices.groups ?? {}).map(
					([name, range]) => [name, range ?? null],
				),
			});
			if (match[0] === "") {
				const index = regex.lastIndex;
				const high = text.charCodeAt(index),
					low = text.charCodeAt(index + 1);
				regex.lastIndex +=
					(flags.includes("u") || flags.includes("v")) &&
					high >= 0xd800 &&
					high <= 0xdbff &&
					low >= 0xdc00 &&
					low <= 0xdfff
						? 2
						: 1;
			}
		}
		cases.push({ source, flags, input, matches });
	}
}

writeFileSync(
	process.argv[2] ??
		new URL("./tests/fixtures/anchored-v8.json", import.meta.url),
	`${JSON.stringify({
		recordedWith: { node: process.versions.node, icu: process.versions.icu },
		cases,
	})}\n`,
);
console.log(
	JSON.stringify({
		node: process.versions.node,
		icu: process.versions.icu,
		cases: cases.length,
	}),
);
