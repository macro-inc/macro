import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { searchWithRg, type SearchMode } from "./search-core.js";
import type { RgParallelDetails } from "./types.js";
import { clamp, groupHitsByFile, toAbsolutePath, writeTempFile } from "./util.js";

const GrepParams = Type.Object({
	pattern: Type.String({ description: "Regex or literal pattern to search for" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search. Defaults to cwd." })),
	glob: Type.Optional(Type.String({ description: "Optional ripgrep glob, e.g. *.ts" })),
	contextLines: Type.Optional(Type.Integer({ minimum: 0, maximum: 8, default: 0 })),
	maxHits: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000, default: 200 })),
	mode: Type.Optional(
		Type.Union([
			Type.Literal("exact"),
			Type.Literal("balanced"),
			Type.Literal("recall"),
		], { default: "balanced" }),
	),
	literal: Type.Optional(Type.Boolean({ description: "Force fixed-string search instead of regex" })),
});

function renderHits(details: RgParallelDetails): string {
	if (details.hits.length === 0) return "No matches found";
	const summary = `${details.returnedHits} hits across ${details.hitsByFile.length} files`;
	const body = details.hits
		.slice(0, 80)
		.map((hit) => `${hit.path}:${hit.line}: ${hit.preview}`)
		.join("\n");
	const footer = [
		details.truncated ? "[truncated]" : "",
		details.searchMode ? `[mode=${details.searchMode}]` : "",
		details.usedFixedStrings ? "[fixed-string]" : "",
	].filter(Boolean).join(" ");
	return `${summary}\n\n${body}${footer ? `\n\n${footer}` : ""}`;
}

export function registerGrepOverride(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "grep",
		label: "grep",
		description:
			"Fast default search using one ripgrep process. Prefer this before reading files. Use mode=exact for fastest lookup, mode=recall for broader coverage.",
		promptSnippet: "grep - Fast ripgrep search for locating relevant files and lines before reading.",
		promptGuidelines: [
			"Prefer grep before read when exploring or locating code.",
			"Use search_and_read_best for the fastest end-to-end exact lookup.",
			"After grep, prefer read_spans for narrow follow-up reads.",
		],
		parameters: GrepParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const rootPath = toAbsolutePath(ctx.cwd, params.path ?? ".");
			const maxHits = clamp(params.maxHits ?? 200, 1, 5000);
			const mode: SearchMode = params.mode ?? "balanced";
			const result = await searchWithRg({
				cwd: ctx.cwd,
				rootPath,
				pattern: params.pattern,
				glob: params.glob,
				contextLines: params.contextLines ?? 0,
				maxHits,
				mode,
				literal: params.literal,
				signal,
			});

			const details: RgParallelDetails = {
				rootPath,
				shardMode: "single",
				shardCount: 1,
				concurrency: 1,
				totalHits: result.hits.length,
				returnedHits: result.hits.length,
				truncated: result.truncated,
				hitsByFile: groupHitsByFile(result.hits),
				hits: result.hits,
				searchMode: mode,
				usedFixedStrings: result.usedFixedStrings,
			};

			if (result.truncated) {
				const fullOutputPath = await writeTempFile(
					"pi-grep-",
					"hits.json",
					JSON.stringify({ rootPath, hits: result.hits, mode, usedFixedStrings: result.usedFixedStrings }, null, 2),
				);
				return {
					content: [{ type: "text", text: `${renderHits({ ...details, fullOutputPath })}\nFull output: ${fullOutputPath}` }],
					details: { ...details, fullOutputPath },
				};
			}

			return {
				content: [{ type: "text", text: renderHits(details) }],
				details,
			};
		},
	});
}
