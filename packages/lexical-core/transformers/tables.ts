import {
	$convertFromMarkdownString,
	$convertToMarkdownString,
	CHECK_LIST,
	type ElementTransformer,
	TRANSFORMERS,
	type Transformer,
} from "@lexical/markdown";
import {
	$computeTableMapSkipCellCheck,
	$createTableNode,
	$createTableRowNode,
	$isTableCellNode,
	$isTableNode,
	$isTableRowNode,
	TableCellHeaderStates,
	TableCellNode,
	TableNode,
	TableRowNode,
} from "@lexical/table";
import { $isParagraphNode, $isTextNode, type LexicalNode } from "lexical";
import { z } from "zod";
import { CUSTOM_TRANSFORMERS } from "./customTransformers";
import { I_IMAGE_CONSTRAINED, IMAGE } from "./image";
import { E_BLOCK_EQUATION_NODE, I_EQUATION_NODE } from "./katex";
import {
	E_CONTACT_MENTION,
	E_DOCUMENT_MENTION,
	E_USER_MENTION,
	I_CONTACT_MENTION,
	I_DOCUMENT_MENTION,
	I_USER_MENTION,
} from "./mentions";
import { BR_TAG_TO_LINE_BREAK, HTML_ENTITY_TRANSFORMERS } from "./transformers";
import { I_VIDEO } from "./video";

// Internal Table Node

const TAG_TABLE = "m-table";
const TAG_TABLE_ROW = "m-table-row";
const TAG_TABLE_CELL = "m-table-cell";

// Like `xmlMatcher`, but tolerates optional `key="value"` attributes on the
// opening tag so attribute-less tags from older documents still match.
// Group 1 is the raw attribute string, group 2 the tag content.
function xmlMatcherWithAttrs(tag: string, flags?: string) {
	return new RegExp(
		`<${tag}((?:\\s+[\\w-]+="[^"]*")*)\\s*>(.*?)</${tag}>`,
		flags ?? "s",
	);
}

function serializeXmlAttrs(
	attrs: Record<string, string | number | undefined>,
): string {
	return Object.entries(attrs)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => ` ${key}="${value}"`)
		.join("");
}

function parseXmlAttrs(raw: string | undefined): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of (raw ?? "").matchAll(/([\w-]+)="([^"]*)"/g)) {
		attrs[match[1]] = match[2];
	}
	return attrs;
}

// Attribute strings from parseXmlAttrs → validated numbers; invalid values are
// coerced away so a bad attr falls back to the node's default.
const A_POSITIVE = z.coerce.number().finite().positive();
const A_SPAN = z.coerce.number().int().min(2);

// Upstream's exact definition from @lexical/table's LexicalTableCellNode.ts;
// the package doesn't re-export the type from its root (not even on main).
type TableCellHeaderState =
	(typeof TableCellHeaderStates)[keyof typeof TableCellHeaderStates];

const HEADER_ATTR_BY_STATE: Record<number, string> = {
	[TableCellHeaderStates.ROW]: "row",
	[TableCellHeaderStates.COLUMN]: "col",
	[TableCellHeaderStates.BOTH]: "both",
};

const HEADER_STATE_BY_ATTR: Record<string, TableCellHeaderState> = {
	row: TableCellHeaderStates.ROW,
	col: TableCellHeaderStates.COLUMN,
	both: TableCellHeaderStates.BOTH,
};

const REG_EXP_XML_TABLE = xmlMatcherWithAttrs(TAG_TABLE, "");
const REG_EXP_XML_TABLE_ROW = xmlMatcherWithAttrs(TAG_TABLE_ROW, "gs");
const REG_EXP_XML_TABLE_CELL = xmlMatcherWithAttrs(TAG_TABLE_CELL, "gs");

const internalTransformersWithinTables: Transformer[] = [
	CHECK_LIST,
	I_USER_MENTION,
	I_DOCUMENT_MENTION,
	I_CONTACT_MENTION,
	I_EQUATION_NODE,
	I_IMAGE_CONSTRAINED,
	IMAGE,
	I_VIDEO,
	...TRANSFORMERS,
];

// Transformers used inside table cells
const _TABLE_CELL_TRANSFORMERS: Transformer[] = [
	...CUSTOM_TRANSFORMERS,
	I_EQUATION_NODE,
	I_USER_MENTION,
	I_DOCUMENT_MENTION,
	I_CONTACT_MENTION,
];

// Transformers that export table cells to markdown
const _TABLE_CELL_EXPORT_TRANSFORMERS: Transformer[] = [
	...CUSTOM_TRANSFORMERS,
	I_EQUATION_NODE,
	I_USER_MENTION,
	I_DOCUMENT_MENTION,
	I_CONTACT_MENTION,
];

export const I_TABLE_NODE: ElementTransformer = {
	dependencies: [TableNode, TableRowNode, TableCellNode],
	type: "element",
	regExp: REG_EXP_XML_TABLE,

	export: (node) => {
		if (!(node instanceof TableNode)) return null;

		const colWidths = node.getColWidths();
		let output = `<${TAG_TABLE}${serializeXmlAttrs({
			"col-widths": colWidths?.map((width) => Math.round(width)).join(","),
		})}>`;
		const rows = node.getChildren();

		for (const row of rows) {
			if (row instanceof TableRowNode) {
				output += `<${TAG_TABLE_ROW}${serializeXmlAttrs({
					height: row.getHeight(),
				})}>`;
				const cells = row.getChildren();

				for (const cell of cells) {
					if (cell instanceof TableCellNode) {
						output += `<${TAG_TABLE_CELL}${serializeXmlAttrs({
							colspan: cell.getColSpan() > 1 ? cell.getColSpan() : undefined,
							rowspan: cell.getRowSpan() > 1 ? cell.getRowSpan() : undefined,
							header: HEADER_ATTR_BY_STATE[cell.__headerState],
						})}>`;
						output += $convertToMarkdownString(
							internalTransformersWithinTables,
							cell,
						).replace(/\n/g, "\\n");
						output += `</${TAG_TABLE_CELL}>`;
					}
				}

				output += `</${TAG_TABLE_ROW}>`;
			}
		}

		output += `</${TAG_TABLE}>`;
		return output;
	},

	replace: (node, _children, match, _isImport) => {
		try {
			const xmlContent = match[0];
			const tableAttrs = parseXmlAttrs(match[1]);
			const tableNode = new TableNode();
			const rowMatches = xmlContent.matchAll(REG_EXP_XML_TABLE_ROW);

			for (const rowMatch of rowMatches) {
				const rowAttrs = parseXmlAttrs(rowMatch[1]);
				const rowContent = rowMatch[2];
				const rowNode = new TableRowNode();

				const height = A_POSITIVE.optional()
					.catch(undefined)
					.parse(rowAttrs.height);
				if (height) {
					rowNode.setHeight(height);
				}

				const cellMatches = rowContent.matchAll(REG_EXP_XML_TABLE_CELL);

				for (const cellMatch of cellMatches) {
					const cellAttrs = parseXmlAttrs(cellMatch[1]);
					const cellContent = cellMatch[2];
					const cellNode = new TableCellNode();

					const colSpan = A_SPAN.optional()
						.catch(undefined)
						.parse(cellAttrs.colspan);
					if (colSpan) {
						cellNode.setColSpan(colSpan);
					}
					const rowSpan = A_SPAN.optional()
						.catch(undefined)
						.parse(cellAttrs.rowspan);
					if (rowSpan) {
						cellNode.setRowSpan(rowSpan);
					}
					const headerState = HEADER_STATE_BY_ATTR[cellAttrs.header];
					if (headerState !== undefined) {
						cellNode.setHeaderStyles(headerState);
					}

					$convertFromMarkdownString(
						cellContent.replace(/\\n/g, "\n").replaceAll("<br>", ""),
						internalTransformersWithinTables,
						cellNode,
					);
					rowNode.append(cellNode);
				}

				tableNode.append(rowNode);
			}

			const colWidths = z
				.array(A_POSITIVE)
				.safeParse(tableAttrs["col-widths"]?.split(","));
			if (colWidths.success && colWidths.data.length) {
				tableNode.setColWidths(colWidths.data);
			}

			node.replace(tableNode);
		} catch (error) {
			console.error("Error parsing m-table:", error);
		}
	},
};

// External Table Node

const REG_EXP_TABLE_ROW = /^(?:\|)(.+)(?:\|)\s?$/;
const REG_EXP_TABLE_ROW_DIVIDER = /^(\| ?:?-*:? ?)+\|\s?$/;

const externalTransformersWithinTables: Transformer[] = [
	BR_TAG_TO_LINE_BREAK,
	CHECK_LIST,
	E_USER_MENTION,
	I_DOCUMENT_MENTION, // for citations
	E_DOCUMENT_MENTION,
	E_CONTACT_MENTION,
	E_BLOCK_EQUATION_NODE,
	IMAGE,
	I_VIDEO,
	...HTML_ENTITY_TRANSFORMERS,
	...TRANSFORMERS,
];

function getTableColumnsSize(table: TableNode): number {
	const row = table.getFirstChild();
	return $isTableRowNode(row) ? row.getChildrenSize() : 0;
}

function createTableCell(cellContent: string): TableCellNode {
	const cellNode = new TableCellNode();
	// Export escapes cell newlines as `\n` so rows stay on one line; restore
	// them so multi-line content (lists, multiple blocks) survives the trip.
	$convertFromMarkdownString(
		cellContent.replace(/\\n/g, "\n").trim(),
		externalTransformersWithinTables,
		cellNode,
		true,
	);
	return cellNode;
}

function mapToTableCells(textContent: string): Array<TableCellNode> | null {
	const match = textContent.match(REG_EXP_TABLE_ROW);
	if (!match || !match[1]) {
		return null;
	}

	return match[1].split("|").map((text) => createTableCell(text));
}

export const E_TABLE_NODE: ElementTransformer = {
	dependencies: [TableNode, TableRowNode, TableCellNode],
	type: "element",
	regExp: REG_EXP_TABLE_ROW,
	export: (node: LexicalNode) => {
		if (!$isTableNode(node)) {
			return null;
		}

		// Walk the computed grid rather than the row children so merged cells
		// (colspan/rowspan) pad the slots they cover and rows stay rectangular —
		// pipe tables cannot express merges.
		const [gridMap] = $computeTableMapSkipCellCheck(node, null, null);

		const output: string[] = [];
		for (let row = 0; row < gridMap.length; row++) {
			const rowOutput: string[] = [];
			let isHeaderRow = false;

			for (let column = 0; column < gridMap[row].length; column++) {
				const mapCell = gridMap[row][column];
				if (!mapCell?.cell) {
					rowOutput.push("");
					continue;
				}

				if (mapCell.startRow === row && mapCell.startColumn === column) {
					const cellContent = $convertToMarkdownString(
						externalTransformersWithinTables,
						mapCell.cell,
					)
						.replace(/\n/g, "\\n")
						.trim();
					rowOutput.push(cellContent);
				} else {
					rowOutput.push("");
				}

				if (
					mapCell.cell.__headerState === TableCellHeaderStates.ROW ||
					mapCell.cell.__headerState === TableCellHeaderStates.BOTH
				) {
					isHeaderRow = true;
				}
			}

			output.push(`| ${rowOutput.join(" | ")} |`);
			if (isHeaderRow) {
				output.push(`| ${rowOutput.map(() => "---").join(" | ")} |`);
			}
		}
		return output.join("\n");
	},
	replace: (parentNode, _unused, match) => {
		if (REG_EXP_TABLE_ROW_DIVIDER.test(match[0])) {
			const table = parentNode.getPreviousSibling();
			if (!table || !$isTableNode(table)) {
				return;
			}

			const rows = table.getChildren();
			const lastRow = rows[rows.length - 1];
			if (!lastRow || !$isTableRowNode(lastRow)) {
				return;
			}

			for (const cell of lastRow.getChildren()) {
				if (!$isTableCellNode(cell)) {
					continue;
				}
				cell.setHeaderStyles(
					TableCellHeaderStates.NO_STATUS,
					TableCellHeaderStates.NO_STATUS,
					// TableCellHeaderStates.ROW, // disable header for now
					// TableCellHeaderStates.ROW // disable header for now
				);
			}

			parentNode.remove();
			return;
		}

		const matchCells = mapToTableCells(match[0]);
		if (matchCells == null) {
			return;
		}

		const rows = [matchCells];
		let sibling = parentNode.getPreviousSibling();
		let maxCells = matchCells.length;

		while (sibling) {
			if (!$isParagraphNode(sibling)) {
				break;
			}
			if (sibling.getChildrenSize() !== 1) {
				break;
			}

			const firstChild = sibling.getFirstChild();
			if (!$isTextNode(firstChild)) {
				break;
			}

			const cells = mapToTableCells(firstChild.getTextContent());
			if (cells == null) {
				break;
			}

			maxCells = Math.max(maxCells, cells.length);
			rows.unshift(cells);

			const previousSibling = sibling.getPreviousSibling();
			sibling.remove();
			sibling = previousSibling;
		}

		const table = $createTableNode();
		for (const cells of rows) {
			const tableRow = $createTableRowNode();
			table.append(tableRow);

			for (let i = 0; i < maxCells; i++) {
				tableRow.append(i < cells.length ? cells[i] : createTableCell(""));
			}
		}

		const previousSibling = parentNode.getPreviousSibling();
		if (
			$isTableNode(previousSibling) &&
			getTableColumnsSize(previousSibling) === maxCells
		) {
			previousSibling.append(...table.getChildren());
			parentNode.remove();
		} else {
			parentNode.replace(table);
		}

		table.selectEnd();
	},
};
