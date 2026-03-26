import { getModel } from "@mariozechner/pi-ai";
import {
	AuthStorage,
	ModelRegistry,
	SessionManager,
	createAgentSession,
	type ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import type { AnalyzePlan, SparkAnalyzeHitsDetails } from "./types.js";
import { extractJsonObject } from "./util.js";

const SparkAnalyzeHitsParams = Type.Object({
	query: Type.String({ description: "User's actual question or task" }),
	hits: Type.Array(
		Type.Object({
			path: Type.String(),
			line: Type.Integer(),
			preview: Type.String(),
			pattern: Type.Optional(Type.String()),
		}),
		{ minItems: 1, maxItems: 400 },
	),
	mode: Type.Optional(
		Type.Union([
			Type.Literal("rank"),
			Type.Literal("cluster"),
			Type.Literal("plan_reads"),
			Type.Literal("summarize"),
		], { default: "plan_reads" }),
	),
	maxFiles: Type.Optional(Type.Integer({ minimum: 1, maximum: 40, default: 12 })),
	maxSpans: Type.Optional(Type.Integer({ minimum: 1, maximum: 80, default: 24 })),
	provider: Type.Optional(Type.String({ default: "openai", description: "Model provider" })),
	model: Type.Optional(Type.String({ default: "gpt-5.4-spark", description: "Model id" })),
});

function buildPrompt(params: {
	readonly query: string;
	readonly hits: readonly { readonly path: string; readonly line: number; readonly preview: string; readonly pattern?: string }[];
	readonly mode: string;
	readonly maxFiles: number;
	readonly maxSpans: number;
}): string {
	return [
		"You are ranking code-search hits.",
		`Mode: ${params.mode}`,
		"Return JSON only with this exact shape:",
		"{",
		'  "relevant": boolean,',
		'  "confidence": number,',
		'  "summary": string,',
		'  "files": [',
		"    {",
		'      "path": string,',
		'      "reason": string,',
		'      "score": number,',
		'      "spans": [',
		"        {",
		'          "startLine": number,',
		'          "endLine": number,',
		'          "reason": string',
		"        }",
		"      ]",
		"    }",
		"  ]",
		"}",
		"Rules:",
		`- Choose at most ${params.maxFiles} files.`,
		`- Choose at most ${params.maxSpans} spans total.`,
		"- Prefer narrow spans.",
		"- Ignore weak false positives.",
		"- Do not include markdown fences.",
		"- If the hits are not relevant, return relevant=false and files=[].",
		`User query: ${params.query}`,
		"Hits:",
		JSON.stringify(params.hits, null, 2),
	].join("\n");
}

function coercePlan(value: unknown): AnalyzePlan {
	const plan = value as AnalyzePlan;
	if (!plan || typeof plan !== "object") throw new Error("Model returned invalid analysis payload");
	if (typeof plan.relevant !== "boolean") throw new Error("Missing plan.relevant");
	if (typeof plan.confidence !== "number") throw new Error("Missing plan.confidence");
	if (typeof plan.summary !== "string") throw new Error("Missing plan.summary");
	if (!Array.isArray(plan.files)) throw new Error("Missing plan.files");
	return plan;
}

export function registerSparkAnalyzeHitsTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "spark_analyze_hits",
		label: "spark analyze hits",
		description:
			"Use a dedicated gpt-5.4 spark analysis session to rank search hits and propose exact spans to read next.",
		promptGuidelines: [
			"Use spark_analyze_hits after rg_parallel when the result set is broad.",
			"Feed the returned spans into read_spans.",
		],
		parameters: SparkAnalyzeHitsParams,
		async execute(_toolCallId, params, signal) {
			const provider = params.provider ?? "openai";
			const modelId = params.model ?? "gpt-5.4-spark";
			const authStorage = AuthStorage.create();
			const modelRegistry = new ModelRegistry(authStorage);
			const model = modelRegistry.find(provider, modelId) ?? getModel(provider, modelId);
			if (!model) {
				throw new Error(`Model ${provider}/${modelId} not found. Add it to pi models or pick another provider/model.`);
			}

			const { session } = await createAgentSession({
				authStorage,
				modelRegistry,
				model,
				sessionManager: SessionManager.inMemory(),
				tools: [],
				thinkingLevel: "minimal",
			});

			let output = "";
			const unsubscribe = session.subscribe((event) => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					output += event.assistantMessageEvent.delta;
				}
			});

			const abort = async () => {
				try {
					await session.abort();
				} catch {
					// ignore abort errors
				}
			};
			signal.addEventListener("abort", () => void abort(), { once: true });

			try {
				await session.prompt(
					buildPrompt({
						query: params.query,
						hits: params.hits,
						mode: params.mode ?? "plan_reads",
						maxFiles: params.maxFiles ?? 12,
						maxSpans: params.maxSpans ?? 24,
					}),
				);
			} finally {
				unsubscribe();
				session.dispose();
			}

			const plan = coercePlan(JSON.parse(extractJsonObject(output)));
			const details: SparkAnalyzeHitsDetails = {
				provider,
				model: modelId,
				plan,
			};

			return {
				content: [{ type: "text", text: plan.summary }],
				details,
			};
		},
	});
}
