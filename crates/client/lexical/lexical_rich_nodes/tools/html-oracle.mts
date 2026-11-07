// Run from the repository root: bun crates/client/lexical/lexical_rich_nodes/tools/html-oracle.mts
// Pinned installed Lexical 0.45.0 and linkedom 0.18.13 are the export oracle.
import { writeFileSync } from "node:fs";
const root = process.cwd() + "/node_modules/";
const load = (path: string) => import(root + path);
const L = await load("lexical/dist/Lexical.node.mjs");
const { createHeadlessEditor } = await load(
	"@lexical/headless/dist/LexicalHeadless.node.mjs",
);
const { $generateHtmlFromNodes } = await load(
	"@lexical/html/dist/LexicalHtml.node.mjs",
);
const R = await load("@lexical/rich-text/dist/LexicalRichText.node.mjs");
const C = await load("@lexical/code/dist/LexicalCode.node.mjs");
const A = await load("@lexical/link/dist/LexicalLink.node.mjs");
const I = await load("@lexical/list/dist/LexicalList.node.mjs");
const T = await load("@lexical/table/dist/LexicalTable.node.mjs");
const M = await load("@lexical/mark/dist/LexicalMark.node.mjs");
const { parseHTML } = await load("linkedom/esm/index.js");
const { window } = parseHTML("<html><body></body></html>");
for (const key of [
	"window",
	"document",
	"HTMLElement",
	"DocumentFragment",
	"Text",
	"Node",
])
	globalThis[key] = key === "window" ? window : window[key];
const nodes = [
	R.HeadingNode,
	R.QuoteNode,
	C.CodeNode,
	C.CodeHighlightNode,
	A.LinkNode,
	A.AutoLinkNode,
	I.ListNode,
	I.ListItemNode,
	T.TableNode,
	T.TableRowNode,
	T.TableCellNode,
	M.MarkNode,
];
const text = (value = "x", format = 0, style = "") => ({
	type: "text",
	version: 1,
	text: value,
	format,
	detail: 0,
	mode: "normal",
	style,
});
const element = (type, children = [], own = {}) => ({
	children,
	direction: null,
	format: "",
	indent: 0,
	type,
	version: 1,
	...own,
});
const fixtures = [];
function record(name, children, theme = {}, selection = null) {
	const input = { root: element("root", children) };
	const editor = createHeadlessEditor({
		namespace: "html-oracle",
		nodes,
		theme,
		onError(e) {
			throw e;
		},
	});
	const state = editor.parseEditorState(JSON.stringify(input));
	editor.setEditorState(state);
	const html = state.read(
		() => {
			let selected = null;
			if (selection) {
				selected = L.$createRangeSelection();
				for (const role of ["anchor", "focus"]) {
					const point = selection[role];
					let node = L.$getRoot();
					for (const index of point.path) node = node.getChildren()[index];
					selected[role].set(node.getKey(), point.offset, point.kind ?? "text");
				}
			}
			return $generateHtmlFromNodes(editor, selected);
		},
		{ editor },
	);
	fixtures.push({ name, input, theme, selection, html });
}
for (let format = 0; format < 2048; format++)
	record(`text-format-${format}`, [
		element("paragraph", [
			text("a<&>\u00a0😀", format, "color:red !important; --x:1"),
		]),
	]);
for (let level = 1; level <= 6; level++)
	record(`heading-${level}`, [
		element("heading", [], {
			tag: `h${level}`,
			format: "center",
			indent: 2,
			direction: "rtl",
		}),
	]);
record("quote", [
	element("quote", [text("a"), { type: "linebreak", version: 1 }, text("b")]),
]);
record(
	"code",
	[
		element(
			"code",
			[
				{ ...text("const"), type: "code-highlight", highlightType: "keyword" },
				{ type: "tab", version: 1, ...text("\t") },
				text("<&"),
			],
			{
				language: "js",
				theme: "dark",
				style: "color:blue",
				indent: 2,
				direction: "rtl",
			},
		),
	],
	{ code: "code c", codeHighlight: { keyword: "kw k" } },
);
for (const url of [
	'https://example.com/?a=1&b="2"',
	"javascript:alert(1)",
	"person@example.com",
	"/relative",
])
	record(
		`link-${url}`,
		[
			element("paragraph", [
				element("link", [text("run")], {
					url,
					target: "_blank",
					rel: "noopener",
					title: 'a"b&',
				}),
			]),
		],
		{ link: "lnk" },
	);
for (const isUnlinked of [false, true])
	record(`autolink-${isUnlinked}`, [
		element("paragraph", [
			element("autolink", [text("run")], {
				url: "https://example.com",
				isUnlinked,
			}),
		]),
	]);
record("mark-hoisting", [
	element("paragraph", [element("mark", [text("marked")], { ids: ["a"] })]),
]);
for (const listType of ["number", "bullet", "check"]) {
	const list = (children) =>
		element("list", children, {
			listType,
			start: 3,
			tag: listType === "number" ? "ol" : "ul",
		});
	const li = (children, checked = false) =>
		element("listitem", children, { value: 1, checked });
	record(
		`list-${listType}`,
		[
			list([
				li([text("one")], true),
				li([text("two")]),
				li([list([li([text("nested")])])]),
			]),
		],
		{
			list: {
				ol: "ol",
				ul: "ul",
				olDepth: ["d0", "d1"],
				ulDepth: ["u0", "u1"],
				checklist: "check",
				listitem: "item",
				listitemChecked: "yes",
				listitemUnchecked: "no",
				nested: { list: "nested", listitem: "nested-item" },
			},
		},
	);
}
for (const headerState of [0, 1, 2, 3])
	record(
		`table-${headerState}`,
		[
			element(
				"table",
				[
					element(
						"tablerow",
						[
							element("tablecell", [element("paragraph", [text("cell")])], {
								headerState,
								colSpan: 1,
								rowSpan: 1,
								width: 120,
								backgroundColor: null,
								verticalAlign: "middle",
							}),
						],
						{ height: 25 },
					),
				],
				{
					colWidths: [120],
					rowStriping: true,
					format: "center",
					indent: 1,
					direction: "ltr",
				},
			),
		],
		{
			table: "table",
			tableRow: "row",
			tableCell: "cell",
			tableCellHeader: "header",
			tableRowStriping: "stripe",
			tableAlignment: { center: "center" },
		},
	);
record("all-text-theme", [element("paragraph", [text("theme", 2047)])], {
	paragraph: "p",
	text: {
		base: "base",
		bold: "b",
		capitalize: "cap",
		code: "code",
		highlight: "hl",
		italic: "i",
		lowercase: "lc",
		strikethrough: "s",
		subscript: "sub",
		superscript: "sup",
		underline: "u",
		uppercase: "uc",
		underlineStrikethrough: "us",
	},
});

const point = (path, offset, kind = "text") => ({ path, offset, kind });
for (const backward of [false, true]) {
	const anchor = point([0, 0], 1),
		focus = point([0, 1], 2);
	record(
		`selected-link-${backward}`,
		[
			element("paragraph", [
				text("abc"),
				element("link", [text("def")], { url: "https://example.com" }),
			]),
		],
		{},
		{
			anchor: backward ? point([0, 1, 0], 2) : anchor,
			focus: backward ? anchor : point([0, 1, 0], 2),
		},
	);
	record(
		`selected-check-${backward}`,
		[
			element(
				"list",
				[
					element("listitem", [text("abc")], { value: 1, checked: true }),
					element("listitem", [text("def")], { value: 2, checked: false }),
				],
				{ listType: "check", start: 1, tag: "ul" },
			),
		],
		{},
		{
			anchor: point([0, backward ? 1 : 0, 0], backward ? 2 : 1),
			focus: point([0, backward ? 0 : 1, 0], backward ? 1 : 2),
		},
	);
}
record(
	"selected-table-column",
	[
		element(
			"table",
			[
				element("tablerow", [
					element("tablecell", [element("paragraph", [text("first")])], {
						headerState: 0,
						colSpan: 1,
						rowSpan: 1,
						backgroundColor: null,
					}),
					element("tablecell", [element("paragraph", [text("second")])], {
						headerState: 0,
						colSpan: 1,
						rowSpan: 1,
						backgroundColor: null,
					}),
				]),
			],
			{ colWidths: [60, 90] },
		),
	],
	{},
	{ anchor: point([0, 0, 1, 0, 0], 0), focus: point([0, 0, 1, 0, 0], 6) },
);
writeFileSync(
	"crates/client/lexical/lexical_rich_nodes/tests/corpus/html.jsonl",
	fixtures.map((f) => JSON.stringify(f)).join("\n") + "\n",
);
console.log(`Recorded ${fixtures.length} upstream HTML exports`);
