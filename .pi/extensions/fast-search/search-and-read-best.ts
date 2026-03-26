import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readCachedRanges } from "./file-cache.js";
import { searchWithRg, type SearchMode } from "./search-core.js";
import type { ReadSpanResult, RequestedSpan, RgHit, SearchAndReadBestDetails } from "./types.js";
import { clamp, mapWithConcurrencyLimit, mergeOverlappingSpans, toAbsolutePath, writeTempFile } from "./util.js";

const SearchAndReadBestParams = Type.Object({
	pattern: Type.String({ description: "Regex or literal pattern to search for" }),
	path: Type.Optional(Type.String({ description: "Directory or file to search. Defaults to cwd." })),
	glob: Type.Optional(Type.String({ description: "Optional ripgrep glob, e.g. *.ts" })),
	mode: Type.Optional(
		Type.Union([
			Type.Literal("exact"),
			Type.Literal("balanced"),
			Type.Literal("recall"),
		], { default: "exact" }),
	),
	literal: Type.Optional(Type.Boolean({ description: "Force fixed-string search instead of regex" })),
	maxHits: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000, default: 64 })),
	readTopFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: 16, default: 3 })),
	readTopSpans: Type.Optional(Type.Integer({ minimum: 1, maximum: 32, default: 6 })),
	spanRadius: Type.Optional(Type.Integer({ minimum: 0, maximum: 40, default: 12 })),
	maxTotalLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000, default: 400 })),
});

interface ScoredHit {
	readonly hit: RgHit;
	readonly score: number;
}

interface RankedFile {
	readonly path: string;
	readonly score: number;
	readonly hits: readonly ScoredHit[];
}

function normalizePattern(pattern: string): string {
	return pattern.toLowerCase().replace(/[^a-z0-9/_-]+/g, " ").trim();
}

function computeHitScore(hit: RgHit, pattern: string, hitCountInFile: number): number {
	const preview = hit.preview.toLowerCase();
	const normalizedPattern = normalizePattern(pattern);
	const normalizedPath = hit.path.toLowerCase();
	const baseName = path.basename(hit.path).toLowerCase();
	let score = 0;

	if (normalizedPattern.length > 0 && preview.includes(normalizedPattern)) score += 12;
	if (normalizedPattern.length > 0 && normalizedPath.includes(normalizedPattern)) score += 5;
	if (normalizedPattern.length > 0 && baseName.includes(normalizedPattern)) score += 4;
	if (/^\s*(export\s+)?(async\s+)?(function|const|class|interface|type|enum)\b/.test(hit.preview)) score += 4;
	if (/\b(import|from)\b/.test(hit.preview)) score -= 1;
	if (hit.line <= 120) score += 2;
	if (hit.line <= 400) score += 1;
	if (pattern.includes("/") && hit.preview.includes(pattern)) score += 6;
	if (/^[A-Z0-9_]+$/.test(pattern) && hit.preview.includes(pattern)) score += 6;
	score += Math.min(hitCountInFile, 4);
	return score;
}

function rankFiles(hits: readonly RgHit[], pattern: string): readonly RankedFile[] {
	const grouped = new Map<string, RgHit[]>();
	for (const hit of hits) {
		const list = grouped.get(hit.path) ?? [];
		list.push(hit);
		grouped.set(hit.path, list);
	}

	return Array.from(grouped.entries())
		.map(([filePath, fileHits]) => {
			const scoredHits = fileHits
				.map((hit) => ({ hit, score: computeHitScore(hit, pattern, fileHits.length) }))
				.sort((a, b) => b.score - a.score || a.hit.line - b.hit.line);
			const score = scoredHits.slice(0, 3).reduce((sum, hit) => sum + hit.score, 0) + Math.min(fileHits.length, 4);
			return {
				path: filePath,
				score,
				hits: scoredHits,
			};
		})
		.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function selectSpans(rankedFiles: readonly RankedFile[], readTopFiles: number, readTopSpans: number, spanRadius: number): {
	readonly spans: readonly RequestedSpan[];
	readonly selectedHits: readonly RgHit[];
} {
	const spans: RequestedSpan[] = [];
	const selectedHits: RgHit[] = [];
	const chosenFiles = rankedFiles.slice(0, readTopFiles);

	for (const file of chosenFiles) {
		for (const scoredHit of file.hits) {
			const overlapsExisting = spans.some((span) =>
				span.path === scoredHit.hit.path &&
				scoredHit.hit.line >= span.startLine - spanRadius &&
				scoredHit.hit.line <= span.endLine + spanRadius,
			);
			if (overlapsExisting) continue;
			selectedHits.push(scoredHit.hit);
			spans.push({
				path: scoredHit.hit.path,
				startLine: Math.max(1, scoredHit.hit.line - spanRadius),
				endLine: scoredHit.hit.line + spanRadius,
				reason: `High-score search hit (${scoredHit.score})`,
			});
			if (spans.length >= readTopSpans) {
				return { spans, selectedHits };
			}
		}
	}

	return { spans, selectedHits };
}

function renderHitSummary(hits: readonly RgHit[]): string {
	if (hits.length === 0) return "No candidate hits";
	return hits
		.slice(0, 12)
		.map((hit) => `${hit.path}:${hit.line}: ${hit.preview}`)
		.join("\n");
}

function renderSnippets(snippets: readonly string[]): string {
	return snippets.join("\n\n");
}

export function registerSearchAndReadBestTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "search_and_read_best",
		label: "search and read best",
		description:
			"Fastest end-to-end lexical lookup. Search with ripgrep, rank the strongest hits deterministically, then read the best spans immediately in one tool call.",
		promptSnippet: "search_and_read_best - Search and immediately read the strongest matching snippets in one fast tool call.",
		promptGuidelines: [
			"Use search_and_read_best for exact lookups before doing multi-step grep then read.",
			"Use grep for broad recall searches and read_spans for wider follow-up reads.",
		],
		parameters: SearchAndReadBestParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const rootPath = toAbsolutePath(ctx.cwd, params.path ?? ".");
			const mode: SearchMode = params.mode ?? "exact";
			const maxHits = clamp(params.maxHits ?? 64, 1, 5000);
			const search = await searchWithRg({
				cwd: ctx.cwd,
				rootPath,
				pattern: params.pattern,
				glob: params.glob,
				contextLines: 0,
				maxHits,
				mode,
				literal: params.literal,
				signal,
			});
			const rankedFiles = rankFiles(search.hits, params.pattern);
			const selection = selectSpans(
				rankedFiles,
				params.readTopFiles ?? 3,
				params.readTopSpans ?? 6,
				params.spanRadius ?? 12,
			);
			const mergedSpans = mergeOverlappingSpans(selection.spans, 0, true);
			const groupedSpans = new Map<string, RequestedSpan[]>();
			for (const span of mergedSpans) {
				const list = groupedSpans.get(span.path) ?? [];
				list.push(span);
				groupedSpans.set(span.path, list);
			}

			const fileReads = await mapWithConcurrencyLimit(Array.from(groupedSpans.entries()), 8, async ([filePath, spans]) => ({
				path: filePath,
				read: await readCachedRanges(filePath, spans),
			}));

			const maxTotalLines = params.maxTotalLines ?? 400;
			const snippets: string[] = [];
			const spanResults: ReadSpanResult[] = [];
			let totalLines = 0;
			let readTruncated = false;

			for (const fileRead of fileReads) {
				for (let index = 0; index < fileRead.read.spans.length; index += 1) {
					const span = fileRead.read.spans[index];
					const lineCount = span.returnedEndLine - span.returnedStartLine + 1;
					if (totalLines + lineCount > maxTotalLines) {
						readTruncated = true;
						break;
					}
					totalLines += lineCount;
					spanResults.push(span);
					snippets.push(fileRead.read.snippets[index]);
				}
				if (readTruncated) break;
			}

			const truncated = search.truncated || readTruncated;
			const details: SearchAndReadBestDetails = {
				rootPath,
				pattern: params.pattern,
				searchMode: mode,
				candidateHitCount: search.hits.length,
				selectedFileCount: fileReads.length,
				selectedSpanCount: spanResults.length,
				totalLines,
				truncated,
				usedFixedStrings: search.usedFixedStrings,
				hits: selection.selectedHits,
				spans: spanResults,
			};

			const content = [
				`${selection.selectedHits.length} ranked hits selected from ${search.hits.length} candidates`,
				"",
				"Top hits:",
				renderHitSummary(selection.selectedHits),
				"",
				"Snippets:",
				renderSnippets(snippets),
				truncated ? "\n[truncated]" : "",
			].filter(Boolean).join("\n");

			if (truncated) {
				const fullOutputPath = await writeTempFile(
					"pi-search-read-",
					"details.json",
					JSON.stringify({ rootPath, search, rankedFiles, selectedSpans: mergedSpans, spanResults }, null, 2),
				);
				return {
					content: [{ type: "text", text: `${content}\nFull output: ${fullOutputPath}` }],
					details: { ...details, fullOutputPath },
				};
			}

			return {
				content: [{ type: "text", text: content }],
				details,
			};
		},
	});
}
