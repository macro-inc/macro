import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readCachedRanges } from "./file-cache.js";
import type { ReadSpanResult, ReadSpansDetails, RequestedSpan } from "./types.js";
import { clamp, mapWithConcurrencyLimit, mergeOverlappingSpans, toAbsolutePath } from "./util.js";

const ReadSpansParams = Type.Object({
	spans: Type.Array(
		Type.Object({
			path: Type.String(),
			startLine: Type.Integer({ minimum: 1 }),
			endLine: Type.Integer({ minimum: 1 }),
			reason: Type.Optional(Type.String()),
		}),
		{ minItems: 1, maxItems: 200 },
	),
	mergeOverlaps: Type.Optional(Type.Boolean({ default: true })),
	padLines: Type.Optional(Type.Integer({ minimum: 0, maximum: 20, default: 2 })),
	concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 32, default: 8 })),
	maxFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 24 })),
	maxTotalLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000, default: 1200 })),
});

interface FileRead {
	readonly path: string;
	readonly snippets: readonly string[];
	readonly spans: readonly ReadSpanResult[];
	readonly lineCount: number;
}

async function readFileSpans(pathLabel: string, spans: readonly RequestedSpan[]): Promise<FileRead> {
	const read = await readCachedRanges(pathLabel, spans);

	return {
		path: pathLabel,
		snippets: read.snippets,
		spans: read.spans,
		lineCount: read.totalLines,
	};
}

export function registerReadSpansTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read_spans",
		label: "read spans",
		description:
			"Read many targeted file spans concurrently using an in-memory file cache. Prefer this after rg_parallel or spark_analyze_hits instead of whole-file reads.",
		promptGuidelines: [
			"Use read_spans for targeted follow-up after search.",
			"Prefer search_and_read_best for the fastest exact lookup in one tool call.",
			"Prefer narrow spans over full-file reads.",
		],
		parameters: ReadSpansParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const mergeOverlaps = params.mergeOverlaps ?? true;
			const padLines = params.padLines ?? 2;
			const maxFiles = params.maxFiles ?? 24;
			const maxTotalLines = params.maxTotalLines ?? 1200;
			const concurrency = clamp(params.concurrency ?? 8, 1, 32);

			const normalized = params.spans.map((span) => ({
				...span,
				path: toAbsolutePath(ctx.cwd, span.path),
			}));
			const merged = mergeOverlappingSpans(normalized, padLines, mergeOverlaps);
			const grouped = new Map<string, RequestedSpan[]>();
			for (const span of merged) {
				const list = grouped.get(span.path) ?? [];
				list.push(span);
				grouped.set(span.path, list);
			}

			const selectedFiles = Array.from(grouped.entries()).slice(0, maxFiles);
			const fileReads = await mapWithConcurrencyLimit(selectedFiles, concurrency, async ([filePath, spans]) =>
				readFileSpans(filePath, spans),
			);

			const snippets: string[] = [];
			const spanResults: ReadSpanResult[] = [];
			let totalLines = 0;
			let truncated = false;

			for (const fileRead of fileReads) {
				for (let index = 0; index < fileRead.spans.length; index += 1) {
					const spanResult = fileRead.spans[index];
					const spanLineCount = spanResult.returnedEndLine - spanResult.returnedStartLine + 1;
					if (totalLines + spanLineCount > maxTotalLines) {
						truncated = true;
						break;
					}
					totalLines += spanLineCount;
					spanResults.push(spanResult);
					snippets.push(fileRead.snippets[index]);
				}
				if (truncated) break;
			}

			const details: ReadSpansDetails = {
				requestedSpanCount: params.spans.length,
				mergedSpanCount: merged.length,
				fileCount: selectedFiles.length,
				totalLines,
				truncated,
				spans: spanResults,
			};

			return {
				content: [{ type: "text", text: `${snippets.join("\n\n")}${truncated ? "\n\n[truncated]" : ""}` }],
				details,
			};
		},
	});
}
