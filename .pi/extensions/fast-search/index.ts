import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerGrepOverride } from "./grep.js";
import { registerReadOverride } from "./read.js";
import { registerReadSpansTool } from "./read-spans.js";
import { registerRgParallelTool } from "./rg.js";
import { registerSearchAndReadBestTool } from "./search-and-read-best.js";
import { registerSparkAnalyzeHitsTool } from "./spark.js";

export default function (pi: ExtensionAPI): void {
	registerGrepOverride(pi);
	registerReadOverride(pi);
	registerSearchAndReadBestTool(pi);
	registerRgParallelTool(pi);
	registerReadSpansTool(pi);
	registerSparkAnalyzeHitsTool(pi);
}
