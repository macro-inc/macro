import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import type { NormalizedSpan, RequestedSpan, RgFileSummary, RgHit } from "./types.js";

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function toAbsolutePath(cwd: string, inputPath: string): string {
	const normalized = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	return path.resolve(cwd, normalized);
}

export async function mapWithConcurrencyLimit<TIn, TOut>(
	items: readonly TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = clamp(concurrency, 1, items.length);
	const results = new Array<TOut>(items.length);
	let nextIndex = 0;

	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			if (currentIndex >= items.length) return;
			results[currentIndex] = await fn(items[currentIndex], currentIndex);
		}
	});

	await Promise.all(workers);
	return results;
}

export function groupHitsByFile(hits: readonly RgHit[]): readonly RgFileSummary[] {
	const grouped = new Map<string, { hitCount: number; firstLine: number; lastLine: number }>();
	for (const hit of hits) {
		const existing = grouped.get(hit.path);
		if (existing) {
			existing.hitCount += 1;
			existing.firstLine = Math.min(existing.firstLine, hit.line);
			existing.lastLine = Math.max(existing.lastLine, hit.line);
			continue;
		}
		grouped.set(hit.path, {
			hitCount: 1,
			firstLine: hit.line,
			lastLine: hit.line,
		});
	}

	return Array.from(grouped.entries())
		.map(([filePath, value]) => ({ path: filePath, ...value }))
		.sort((a, b) => b.hitCount - a.hitCount || a.path.localeCompare(b.path));
}

export function mergeOverlappingSpans(
	spans: readonly RequestedSpan[],
	padLines: number,
	mergeOverlaps: boolean,
): readonly NormalizedSpan[] {
	const normalized = spans
		.map((span) => ({
			path: span.path,
			startLine: Math.max(1, Math.min(span.startLine, span.endLine) - padLines),
			endLine: Math.max(span.startLine, span.endLine) + padLines,
			reason: span.reason,
		}))
		.sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine || a.endLine - b.endLine);

	if (!mergeOverlaps) return normalized;

	const merged: NormalizedSpan[] = [];
	for (const span of normalized) {
		const previous = merged.at(-1);
		if (!previous || previous.path !== span.path || span.startLine > previous.endLine + 1) {
			merged.push(span);
			continue;
		}

		merged[merged.length - 1] = {
			path: previous.path,
			startLine: previous.startLine,
			endLine: Math.max(previous.endLine, span.endLine),
			reason: previous.reason ?? span.reason,
		};
	}

	return merged;
}

export function renderSnippet(pathLabel: string, startLine: number, endLine: number, lines: readonly string[]): string {
	const body = lines
		.map((line, index) => {
			const lineNumber = startLine + index;
			return `${lineNumber.toString().padStart(4, " ")} | ${line}`;
		})
		.join("\n");
	return `=== ${pathLabel}:${startLine}-${endLine} ===\n${body}`;
}

export function compactHitPreview(hit: RgHit): string {
	const before = hit.before.map((line) => `    ${line}`).join("\n");
	const after = hit.after.map((line) => `    ${line}`).join("\n");
	const parts = [
		`${hit.path}:${hit.line}: ${hit.preview}`,
		before,
		after,
	].filter(Boolean);
	return parts.join("\n");
}

export function extractJsonObject(text: string): string {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced?.[1]) return fenced[1].trim();

	const firstBrace = text.indexOf("{");
	const lastBrace = text.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		return text.slice(firstBrace, lastBrace + 1);
	}
	throw new Error("Could not find JSON object in model output");
}

export async function writeTempFile(prefix: string, fileName: string, content: string): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	const filePath = path.join(dir, fileName);
	await withFileMutationQueue(filePath, async () => {
		await fs.writeFile(filePath, content, "utf8");
	});
	return filePath;
}
