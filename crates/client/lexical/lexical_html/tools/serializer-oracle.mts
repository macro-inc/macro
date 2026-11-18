// Run from repository root with Bun; linkedom 0.18.13 is the serializer oracle.
import { writeFileSync } from "node:fs";
const { parseHTML } = await import(
	process.cwd() + "/node_modules/linkedom/esm/index.js"
);
const { document } = parseHTML("<html></html>");
const cases = [
	[
		"reverse-and-update",
		"p",
		[
			["attr", "a", "1"],
			["attr", "b", "2"],
			["attr", "a", "3"],
			["attr", "c", '&<"\u00a0'],
		],
	],
	[
		"empty-attrs",
		"p",
		[
			["attr", "id", ""],
			["attr", "class", ""],
			["attr", "style", ""],
			["attr", "contenteditable", ""],
			["attr", "disabled", ""],
			["attr", "data-empty", ""],
		],
	],
	[
		"style-order",
		"p",
		[
			["style", "color", "red"],
			["style", "padding", "1px"],
			["style", "color", "blue"],
			["removeStyle", "padding"],
			["style", "marginLeft", "2px"],
		],
	],
	[
		"raw-style",
		"p",
		[
			["attr", "style", "color: red; padding: 1px; x: url(a:b)"],
			["style", "color", "blue"],
			["style", "--Foo", "0"],
		],
	],
	[
		"verbatim-classes",
		"p",
		[
			["class", "x y"],
			["class", "z"],
			["class", "x y"],
			["attr", "class", "a  b a\ufeffc"],
			["class", "d e"],
			["class", "f"],
		],
	],
	["text-escapes", "p", [["text", "<&>\u00a0\"'😀"]]],
	[
		"case-void",
		"IMG",
		[
			["attr", "tabIndex", "-1"],
			["attr", "src", "a&b"],
			["text", "ignored"],
		],
	],
	[
		"style-empty",
		"p",
		[
			["style", "x", ""],
			["style", "y", "0"],
			["removeStyle", "y"],
		],
	],
	[
		"css-capitals",
		"p",
		[
			["style", "XMLHttpRequest", "x"],
			["style", "msTransition", "y"],
			["style", "--myValue", "z"],
		],
	],
	[
		"bare-bool",
		"input",
		[
			["attr", "checked", ""],
			["attr", "readonly", ""],
			["attr", "value", ""],
			["attr", "aria-hidden", "false"],
		],
	],
];
const output = cases.map(([name, tag, ops]) => {
	const element = document.createElement(tag);
	for (const [op, key, value] of ops)
		switch (op) {
			case "attr":
				element.setAttribute(key, value);
				break;
			case "style":
				element.style.setProperty(key, value);
				break;
			case "removeStyle":
				element.style.removeProperty(key);
				break;
			case "class":
				element.classList.add(key);
				break;
			case "text":
				element.textContent = key;
				break;
		}
	return { name, tag, ops, html: element.outerHTML };
});
writeFileSync(
	"crates/client/lexical/lexical_html/tests/corpus/serializer.json",
	JSON.stringify(output, null, 2) + "\n",
);
console.log(`Recorded ${output.length} linkedom serializer cases`);
