import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createOpenAI } from "@ai-sdk/openai";
import { zValidator } from "@hono/zod-validator";
import type { LanguageModel } from "ai";
import { Hono } from "hono";
import * as z from "zod";
import { runEditSession } from "../run-edit";
import { runInSandbox } from "../sandbox";
import type { Bindings, EnvVariables } from "../env";

type Provider = "anthropic" | "cerebras" | "openai";

const PROVIDERS = {
	anthropic: { key: "ANTHROPIC_API_KEY" as const, model: "claude-sonnet-4-6", create: createAnthropic },
	cerebras: { key: "CEREBRAS_API_KEY" as const, model: "gpt-oss-120b", create: createCerebras },
	openai: { key: "OPENAI_API_KEY" as const, model: "gpt-4o", create: createOpenAI },
} satisfies Record<Provider, { key: keyof Bindings; model: string; create: (opts: { apiKey: string }) => (modelId: string) => LanguageModel }>;

function createModel(provider: Provider, modelId: string, apiKey: string): LanguageModel {
	return PROVIDERS[provider].create({ apiKey })(modelId);
}

// our default "large" fallback model, TODO(wolf): maybe we want something else?
const FALLBACK_MODEL_ID = "claude-sonnet-4-6";

const EditBody = z.object({
	token: z.string(),
	documentId: z.string(),
	prompt: z.string(),
	provider: z.enum(["anthropic", "cerebras", "openai"]).default("anthropic"),
	model: z.string().optional(),
	typingAnimations: z.boolean().optional(),
	interpret: z.boolean().default(true),
	debug: z.boolean().default(false),
});

const edit = new Hono<{ Bindings: Bindings; Variables: EnvVariables }>();

edit.post("/", zValidator("json", EditBody), async (c) => {
	const env = c.var.env;
	const { token, documentId, prompt, provider, model: modelOverride, typingAnimations, interpret, debug } = c.req.valid("json");

	const apiKey = env[PROVIDERS[provider].key];
	const modelId = modelOverride ?? PROVIDERS[provider].model;
	const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${token}`;
	const model = createModel(provider, modelId, apiKey);
	const anthropicKey = env[PROVIDERS.anthropic.key];
	const largeModel = anthropicKey ? createModel("anthropic", FALLBACK_MODEL_ID, anthropicKey) : undefined;
	const signal = c.req.raw.signal;

	try {
		const { usage, ops, trace } = await runEditSession({
			wsUrl,
			documentId,
			prompt,
			model,
			largeModel,
			typingAnimations,
			interpret,
			debug,
			runner: runInSandbox,
			signal,
			searchContacts: async (_query) => [
				{ kind: 'user', userId: 'stub-amy-user-id', email: 'amy@example.com', name: 'Amy' },
			],
		});
		return c.json({ ok: true, usage, ops, trace });
	} catch (err) {
		// 499 is non-standard (client closed request); cast past Hono's status union
		const status = (signal.aborted ? 499 : 502) as 502;
		return c.json({ error: err instanceof Error ? err.message : String(err) }, status);
	}
});

export default edit;
