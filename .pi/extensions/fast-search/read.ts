import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getCachedFile } from "./file-cache.js";
import { clamp, toAbsolutePath } from "./util.js";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

const ReadParams = Type.Object({
	path: Type.String({ description: "Path to the file to read" }),
	offset: Type.Optional(Type.Integer({ minimum: 1, description: "1-indexed starting line" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LINES, description: "Maximum lines to read" })),
});

interface ReadDetails {
	readonly path: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly returnedLines: number;
	readonly truncated: boolean;
}

function takeByByteLimit(lines: readonly string[], maxBytes: number): { readonly lines: readonly string[]; readonly truncated: boolean } {
	const selected: string[] = [];
	let bytes = 0;
	for (const line of lines) {
		const nextBytes = Buffer.byteLength(line + "\n", "utf8");
		if (selected.length > 0 && bytes + nextBytes > maxBytes) {
			return { lines: selected, truncated: true };
		}
		selected.push(line);
		bytes += nextBytes;
	}
	return { lines: selected, truncated: false };
}

function renderRead(pathLabel: string, startLine: number, lines: readonly string[]): string {
	return lines
		.map((line, index) => `${pathLabel}:${startLine + index}: ${line}`)
		.join("\n");
}

export function registerReadOverride(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read",
		label: "read",
		description:
			"Fast default targeted read backed by an in-memory file cache. Read a specific file range. Prefer grep or search_and_read_best first for exploration, then read small ranges instead of full files.",
		promptSnippet: "read - Read a targeted line range from a file. Prefer grep or search_and_read_best first when locating code.",
		promptGuidelines: [
			"Prefer search_and_read_best for fast exact lookups when you only need the best matching snippets.",
			"Prefer grep before read when you do not already know the exact file and lines.",
			"Prefer small read ranges over whole-file reads.",
		],
		parameters: ReadParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const filePath = toAbsolutePath(ctx.cwd, params.path);
			const snapshot = await getCachedFile(filePath);
			const allLines = snapshot.lines;
			const startLine = params.offset ?? 1;
			const requestedLimit = clamp(params.limit ?? 200, 1, MAX_LINES);
			const selectedLines = allLines.slice(startLine - 1, startLine - 1 + requestedLimit);
			const byteLimited = takeByByteLimit(selectedLines, MAX_BYTES);
			const returnedLines = byteLimited.lines.length;
			const endLine = startLine + Math.max(0, returnedLines - 1);
			const truncated = byteLimited.truncated || selectedLines.length < Math.min(requestedLimit, allLines.length - startLine + 1);

			const details: ReadDetails = {
				path: filePath,
				startLine,
				endLine,
				returnedLines,
				truncated,
			};

			const suffix = truncated ? "\n\n[output truncated: narrow the range or use read_spans for multiple targeted ranges]" : "";
			return {
				content: [{ type: "text", text: `${renderRead(filePath, startLine, byteLimited.lines)}${suffix}` }],
				details,
			};
		},
	});
}
