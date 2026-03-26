import { spawn } from "node:child_process";
import type { RgHit } from "./types.js";

export type SearchMode = "exact" | "balanced" | "recall";

export interface SearchWithRgParams {
	readonly cwd: string;
	readonly rootPath: string;
	readonly pattern: string;
	readonly glob?: string;
	readonly contextLines: number;
	readonly maxHits: number;
	readonly mode: SearchMode;
	readonly literal?: boolean;
	readonly signal?: AbortSignal;
}

export interface SearchWithRgResult {
	readonly hits: readonly RgHit[];
	readonly truncated: boolean;
	readonly mode: SearchMode;
	readonly usedFixedStrings: boolean;
}

function looksLiteralPattern(pattern: string): boolean {
	return !/[\\^$.*+?()[\]{}|]/.test(pattern);
}

function parseVimgrepLine(line: string, pattern: string): RgHit | undefined {
	const match = line.match(/^(.*?):(\d+):(\d+):(.*)$/);
	if (!match) return undefined;
	const [, filePath, lineNumber, _column, preview] = match;
	return {
		path: filePath,
		line: Number.parseInt(lineNumber, 10),
		pattern,
		preview: preview.trimEnd(),
		before: [],
		after: [],
	};
}

function parseJsonLine(line: string, pattern: string): RgHit | undefined {
	const event = JSON.parse(line) as {
		readonly type?: string;
		readonly data?: {
			readonly path?: { readonly text?: string };
			readonly line_number?: number;
			readonly lines?: { readonly text?: string };
		};
	};
	if (event.type !== "match") return undefined;
	const filePath = event.data?.path?.text;
	const lineNumber = event.data?.line_number;
	const preview = event.data?.lines?.text;
	if (!filePath || !lineNumber || preview === undefined) return undefined;
	return {
		path: filePath,
		line: lineNumber,
		pattern,
		preview: preview.trimEnd(),
		before: [],
		after: [],
	};
}

export async function searchWithRg(params: SearchWithRgParams): Promise<SearchWithRgResult> {
	const usedFixedStrings = params.literal ?? looksLiteralPattern(params.pattern);
	const useJson = params.contextLines > 0;
	const args = useJson
		? ["--json", "--line-number", "--color", "never", "--context", String(params.contextLines)]
		: ["--vimgrep", "--line-number", "--color", "never"];
	if (usedFixedStrings) args.push("--fixed-strings");
	if (params.glob) args.push("--glob", params.glob);
	args.push(params.pattern, params.rootPath);

	const child = spawn("rg", args, {
		cwd: params.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});

	let stdoutBuffer = "";
	let stderr = "";
	const hits: RgHit[] = [];
	let truncated = false;

	const stop = () => {
		if (!child.killed) child.kill();
	};

	params.signal?.addEventListener("abort", stop, { once: true });
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");

	child.stdout.on("data", (chunk: string) => {
		stdoutBuffer += chunk;
		let newlineIndex = stdoutBuffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = stdoutBuffer.slice(0, newlineIndex);
			stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
			if (line.trim().length > 0) {
				const hit = useJson ? parseJsonLine(line, params.pattern) : parseVimgrepLine(line, params.pattern);
				if (hit) {
					hits.push(hit);
					if (hits.length >= params.maxHits) {
						truncated = true;
						stop();
						break;
					}
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

	params.signal?.removeEventListener("abort", stop);
	if (exitCode !== 0 && exitCode !== 1 && !child.killed) {
		throw new Error(stderr.trim() || `rg exited with code ${exitCode}`);
	}

	return {
		hits,
		truncated,
		mode: params.mode,
		usedFixedStrings,
	};
}
