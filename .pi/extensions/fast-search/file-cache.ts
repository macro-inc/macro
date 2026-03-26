import * as fs from "node:fs/promises";
import type { ReadSpanResult, RequestedSpan } from "./types.js";
import { renderSnippet } from "./util.js";

interface FileCacheEntry {
	readonly path: string;
	readonly mtimeMs: number;
	readonly size: number;
	readonly content: string;
	readonly lines: readonly string[];
	readonly lineOffsets: readonly number[];
}

interface CachedRangeRead {
	readonly snippet: string;
	readonly span: ReadSpanResult;
	readonly lineCount: number;
}

const fileCache = new Map<string, FileCacheEntry>();

function buildLineOffsets(content: string): readonly number[] {
	const offsets = [0];
	for (let index = 0; index < content.length; index += 1) {
		if (content.charCodeAt(index) === 10) {
			offsets.push(index + 1);
		}
	}
	return offsets;
}

function splitLines(content: string): readonly string[] {
	return content.split(/\r?\n/);
}

export async function getCachedFile(path: string): Promise<FileCacheEntry> {
	const stat = await fs.stat(path);
	const cached = fileCache.get(path);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return cached;
	}

	const content = await fs.readFile(path, "utf8");
	const entry: FileCacheEntry = {
		path,
		mtimeMs: stat.mtimeMs,
		size: stat.size,
		content,
		lines: splitLines(content),
		lineOffsets: buildLineOffsets(content),
	};
	fileCache.set(path, entry);
	return entry;
}

function normalizeLineRange(totalLines: number, startLine: number, endLine: number): { readonly startLine: number; readonly endLine: number } {
	const boundedStart = Math.max(1, Math.min(startLine, totalLines));
	const boundedEnd = Math.max(boundedStart, Math.min(Math.max(startLine, endLine), totalLines));
	return {
		startLine: boundedStart,
		endLine: boundedEnd,
	};
}

export async function readCachedRange(path: string, span: RequestedSpan): Promise<CachedRangeRead> {
	const snapshot = await getCachedFile(path);
	const totalLines = Math.max(1, snapshot.lines.length);
	const range = normalizeLineRange(totalLines, span.startLine, span.endLine);
	const snippetLines = snapshot.lines.slice(range.startLine - 1, range.endLine);
	return {
		snippet: renderSnippet(path, range.startLine, range.endLine, snippetLines),
		span: {
			path,
			startLine: span.startLine,
			endLine: span.endLine,
			returnedStartLine: range.startLine,
			returnedEndLine: range.endLine,
			reason: span.reason,
		},
		lineCount: range.endLine - range.startLine + 1,
	};
}

export async function readCachedRanges(path: string, spans: readonly RequestedSpan[]): Promise<{
	readonly snippets: readonly string[];
	readonly spans: readonly ReadSpanResult[];
	readonly totalLines: number;
}> {
	const reads = await Promise.all(spans.map((span) => readCachedRange(path, span)));
	return {
		snippets: reads.map((read) => read.snippet),
		spans: reads.map((read) => read.span),
		totalLines: reads.reduce((sum, read) => sum + read.lineCount, 0),
	};
}

export function clearFileCache(): void {
	fileCache.clear();
}
