export interface RgHit {
	readonly path: string;
	readonly line: number;
	readonly pattern: string;
	readonly preview: string;
	readonly before: readonly string[];
	readonly after: readonly string[];
}

export interface RgFileSummary {
	readonly path: string;
	readonly hitCount: number;
	readonly firstLine: number;
	readonly lastLine: number;
}

export interface RgParallelDetails {
	readonly rootPath: string;
	readonly shardMode: string;
	readonly shardCount: number;
	readonly concurrency: number;
	readonly searchMode?: string;
	readonly usedFixedStrings?: boolean;
	readonly totalHits: number;
	readonly returnedHits: number;
	readonly truncated: boolean;
	readonly fullOutputPath?: string;
	readonly hitsByFile: readonly RgFileSummary[];
	readonly hits: readonly RgHit[];
}

export interface RequestedSpan {
	readonly path: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly reason?: string;
}

export interface NormalizedSpan extends RequestedSpan {
	readonly path: string;
	readonly startLine: number;
	readonly endLine: number;
}

export interface ReadSpanResult {
	readonly path: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly returnedStartLine: number;
	readonly returnedEndLine: number;
	readonly reason?: string;
}

export interface ReadSpansDetails {
	readonly requestedSpanCount: number;
	readonly mergedSpanCount: number;
	readonly fileCount: number;
	readonly totalLines: number;
	readonly truncated: boolean;
	readonly spans: readonly ReadSpanResult[];
}

export interface AnalyzePlanSpan {
	readonly startLine: number;
	readonly endLine: number;
	readonly reason: string;
}

export interface AnalyzePlanFile {
	readonly path: string;
	readonly reason: string;
	readonly score: number;
	readonly spans: readonly AnalyzePlanSpan[];
}

export interface AnalyzePlan {
	readonly relevant: boolean;
	readonly confidence: number;
	readonly summary: string;
	readonly files: readonly AnalyzePlanFile[];
}

export interface SparkAnalyzeHitsDetails {
	readonly provider: string;
	readonly model: string;
	readonly plan: AnalyzePlan;
}

export interface SearchAndReadBestDetails {
	readonly rootPath: string;
	readonly pattern: string;
	readonly searchMode: string;
	readonly candidateHitCount: number;
	readonly selectedFileCount: number;
	readonly selectedSpanCount: number;
	readonly totalLines: number;
	readonly truncated: boolean;
	readonly usedFixedStrings: boolean;
	readonly hits: readonly RgHit[];
	readonly spans: readonly ReadSpanResult[];
	readonly fullOutputPath?: string;
}
