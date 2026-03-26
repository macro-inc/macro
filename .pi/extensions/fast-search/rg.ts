import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { RgHit, RgParallelDetails } from "./types.js";
import { clamp, compactHitPreview, groupHitsByFile, toAbsolutePath, writeTempFile } from "./util.js";

const RgParallelParams = Type.Object({
	patterns: Type.Array(Type.String({ description: "Regex patterns to search for" }), {
		minItems: 1,
		maxItems: 16,
	}),
	path: Type.Optional(Type.String({ description: "Root path to search from. Defaults to cwd." })),
	globs: Type.Optional(
		Type.Array(Type.String({ description: "ripgrep glob like **/*.ts" }), {
			maxItems: 32,
		}),
	),
	contextLines: Type.Optional(Type.Integer({ minimum: 0, maximum: 8, default: 1 })),
	maxHits: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000, default: 300 })),
	maxHitsPerShard: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, default: 100 })),
	concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 16, default: 6 })),
	stopOnFirstMatch: Type.Optional(Type.Boolean({ default: false })),
	stopAfterHits: Type.Optional(Type.Integer({ minimum: 1, maximum: 5000 })),
	shardMode: Type.Optional(
		Type.Union([
			Type.Literal("directories"),
			Type.Literal("patterns"),
			Type.Literal("auto"),
		], { default: "auto" }),
	),
});

type ShardMode = "directories" | "patterns" | "auto";

type RgJsonEvent =
	| {
			readonly type: "match";
			readonly data: {
				readonly path?: { readonly text?: string };
				readonly line_number?: number;
				readonly lines?: { readonly text?: string };
				readonly submatches?: readonly { readonly start: number; readonly end: number; readonly match?: { readonly text?: string } }[];
			};
	  }
	| {
			readonly type: "context";
			readonly data: {
				readonly path?: { readonly text?: string };
				readonly line_number?: number;
				readonly lines?: { readonly text?: string };
			};
	  }
	| { readonly type: string; readonly data?: unknown };

function parseMatchEvent(event: RgJsonEvent): { readonly path: string; readonly lineNumber: number; readonly preview: string } | undefined {
	if (event.type !== "match") return undefined;
	const filePath = event.data.path?.text;
	const lineNumber = event.data.line_number;
	const preview = event.data.lines?.text;
	if (!filePath || !lineNumber || preview === undefined) return undefined;
	return { path: filePath, lineNumber, preview };
}

function parseContextEvent(event: RgJsonEvent): { readonly path: string; readonly lineNumber: number; readonly text: string } | undefined {
	if (event.type !== "context") return undefined;
	const filePath = event.data.path?.text;
	const lineNumber = event.data.line_number;
	const text = event.data.lines?.text;
	if (!filePath || !lineNumber || text === undefined) return undefined;
	return { path: filePath, lineNumber, text };
}

interface RawContextLine {
	readonly line: number;
	readonly text: string;
}

interface RawMatchLine {
	readonly path: string;
	readonly line: number;
	readonly preview: string;
	readonly pattern: string;
	readonly before: readonly RawContextLine[];
	readonly after: readonly RawContextLine[];
}

interface Shard {
	readonly id: string;
	readonly path: string;
	readonly pattern: string;
}

function listDirectoryShards(rootPath: string): readonly string[] {
	const stat = fs.statSync(rootPath);
	if (!stat.isDirectory()) return [rootPath];
	const entries = fs.readdirSync(rootPath, { withFileTypes: true });
	const shards = entries
		.filter((entry) => entry.name !== ".git")
		.map((entry) => path.join(rootPath, entry.name));
	return shards.length === 0 ? [rootPath] : shards;
}

function createShards(rootPath: string, patterns: readonly string[], shardMode: ShardMode): { mode: Exclude<ShardMode, "auto">; shards: readonly Shard[] } {
	const resolvedMode: Exclude<ShardMode, "auto"> = shardMode === "auto"
		? patterns.length > 1
			? "patterns"
			: "directories"
		: shardMode;

	if (resolvedMode === "patterns") {
		return {
			mode: resolvedMode,
			shards: patterns.map((pattern, index) => ({ id: `pattern-${index}`, path: rootPath, pattern })),
		};
	}

	const directories = listDirectoryShards(rootPath);
	return {
		mode: resolvedMode,
		shards: directories.flatMap((shardPath, shardIndex) =>
			patterns.map((pattern, patternIndex) => ({
				id: `dir-${shardIndex}-pattern-${patternIndex}`,
				path: shardPath,
				pattern,
			})),
		),
	};
}

function assignContext(matches: readonly RawMatchLine[], contextByFile: ReadonlyMap<string, readonly RawContextLine[]>, contextLines: number): readonly RgHit[] {
	return matches.map((match) => {
		const context = contextByFile.get(match.path) ?? [];
		const before = context
			.filter((line) => line.line >= match.line - contextLines && line.line < match.line)
			.map((line) => line.text.trimEnd());
		const after = context
			.filter((line) => line.line > match.line && line.line <= match.line + contextLines)
			.map((line) => line.text.trimEnd());
		return {
			path: match.path,
			line: match.line,
			pattern: match.pattern,
			preview: match.preview.trimEnd(),
			before,
			after,
		};
	});
}

async function runShard(
	cwd: string,
	shard: Shard,
	globs: readonly string[],
	contextLines: number,
	maxHitsPerShard: number,
	registerChild?: (child: ChildProcessWithoutNullStreams) => void,
): Promise<readonly RgHit[]> {
	const args = ["--json", "--line-number", "--color", "never", "--context", String(contextLines)];
	for (const glob of globs) args.push("--glob", glob);
	args.push(shard.pattern, shard.path);

	const child = spawn("rg", args, {
		cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});
	registerChild?.(child);

	const matches: RawMatchLine[] = [];
	const contextMap = new Map<string, RawContextLine[]>();
	let stdoutBuffer = "";
	let stderr = "";

	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");

	child.stdout.on("data", (chunk: string) => {
		stdoutBuffer += chunk;
		let newlineIndex = stdoutBuffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = stdoutBuffer.slice(0, newlineIndex);
			stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
			if (line.trim().length > 0) {
				const event = JSON.parse(line) as RgJsonEvent;
				const match = parseMatchEvent(event);
				if (match) {
					matches.push({
						path: match.path,
						line: match.lineNumber,
						preview: match.preview,
						pattern: shard.pattern,
						before: [],
						after: [],
					});
					if (matches.length >= maxHitsPerShard) {
						child.kill();
						break;
					}
				}

				const context = parseContextEvent(event);
				if (context) {
					const list = contextMap.get(context.path) ?? [];
					list.push({ line: context.lineNumber, text: context.text });
					contextMap.set(context.path, list);
				}
			}
			newlineIndex = stdoutBuffer.indexOf("\n");
		}
	});

	child.stderr.on("data", (chunk: string) => {
		stderr += chunk;
	});

	const exitCode = await new Promise<number>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (code) => resolve(code ?? 0));
	});

	if (exitCode !== 0 && exitCode !== 1 && !child.killed) {
		throw new Error(stderr.trim() || `rg exited with code ${exitCode}`);
	}

	const contextByFile = new Map<string, readonly RawContextLine[]>();
	for (const [filePath, lines] of contextMap) {
		contextByFile.set(
			filePath,
			lines.sort((a, b) => a.line - b.line),
		);
	}

	return assignContext(matches, contextByFile, contextLines);
}

async function runShardsFastExit(args: {
	readonly cwd: string;
	readonly shards: readonly Shard[];
	readonly globs: readonly string[];
	readonly contextLines: number;
	readonly maxHitsPerShard: number;
	readonly concurrency: number;
	readonly stopAfterHits?: number;
}): Promise<readonly RgHit[]> {
	const { cwd, shards, globs, contextLines, maxHitsPerShard, concurrency, stopAfterHits } = args;
	if (shards.length === 0) return [];

	const results: RgHit[] = [];
	const activeChildren = new Set<ChildProcessWithoutNullStreams>();
	const targetHits = stopAfterHits;
	let nextIndex = 0;
	let stop = false;

	const killActiveChildren = () => {
		for (const child of activeChildren) {
			try {
				child.kill();
			} catch {
				// ignore kill failures
			}
		}
	};

	const workerCount = clamp(concurrency, 1, shards.length);
	const workers = new Array(workerCount).fill(null).map(async () => {
		while (!stop) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			if (currentIndex >= shards.length) return;

			const shard = shards[currentIndex];
			const shardHits = await runShard(cwd, shard, globs, contextLines, maxHitsPerShard, (child) => {
				activeChildren.add(child);
				child.on("close", () => activeChildren.delete(child));
			});

			if (stop) return;
			results.push(...shardHits);
			if (targetHits !== undefined && results.length >= targetHits) {
				stop = true;
				killActiveChildren();
				return;
			}
		}
	});

	try {
		await Promise.all(workers);
	} finally {
		if (stop) killActiveChildren();
	}

	return results;
}

function renderContent(hits: readonly RgHit[], truncated: boolean): string {
	if (hits.length === 0) return "No matches found";
	const lines = hits.slice(0, 80).map(compactHitPreview);
	const summary = `${hits.length} hits across ${new Set(hits.map((hit) => hit.path)).size} files`;
	return `${summary}\n\n${lines.join("\n\n")}${truncated ? "\n\n[truncated]" : ""}`;
}

export function registerRgParallelTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "rg_parallel",
		label: "rg parallel",
		description:
			"Fast parallel code search using ripgrep subprocesses. Use this before read. Supports fast-exit modes that cancel sibling searches once enough hits are found.",
		promptGuidelines: [
			"Use rg_parallel before broad code exploration.",
			"Prefer read_spans after rg_parallel instead of reading whole files.",
		],
		parameters: RgParallelParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const rootPath = toAbsolutePath(ctx.cwd, params.path ?? ".");
			const concurrency = clamp(params.concurrency ?? 6, 1, 16);
			const contextLines = params.contextLines ?? 1;
			const maxHits = params.maxHits ?? 300;
			const maxHitsPerShard = params.maxHitsPerShard ?? 100;
			const stopAfterHits = params.stopOnFirstMatch ? 1 : params.stopAfterHits;
			const globs = params.globs ?? [];
			const { mode, shards } = createShards(rootPath, params.patterns, params.shardMode ?? "auto");

			const hits = (await runShardsFastExit({
				cwd: ctx.cwd,
				shards,
				globs,
				contextLines,
				maxHitsPerShard,
				concurrency,
				stopAfterHits,
			}))
				.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.pattern.localeCompare(b.pattern));
			const limitedHits = hits.slice(0, maxHits);
			const truncated = limitedHits.length < hits.length;

			const details: RgParallelDetails = {
				rootPath,
				shardMode: mode,
				shardCount: shards.length,
				concurrency,
				totalHits: hits.length,
				returnedHits: limitedHits.length,
				truncated,
				hitsByFile: groupHitsByFile(limitedHits),
				hits: limitedHits,
			};

			if (truncated) {
				const fullOutputPath = await writeTempFile(
					"pi-rg-parallel-",
					"hits.json",
					JSON.stringify({ rootPath, hits }, null, 2),
				);
				return {
					content: [{ type: "text", text: `${renderContent(limitedHits, true)}\nFull output: ${fullOutputPath}` }],
					details: {
						...details,
						fullOutputPath,
					},
				};
			}

			return {
				content: [{ type: "text", text: renderContent(limitedHits, false) }],
				details,
			};
		},
	});
}
