import { createAnthropic } from "@ai-sdk/anthropic";
import { createCerebras } from "@ai-sdk/cerebras";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { env } from "./env";

const DEFAULTS = {
	anthropic: "claude-sonnet-4-6",
	openai: "gpt-4o",
	cerebras: "llama-3.3-70b",
} as const;

function resolveModel(
	providerName: "anthropic" | "openai" | "cerebras",
	modelName: string,
): LanguageModel {
	const model = modelName || DEFAULTS[providerName];
	switch (providerName) {
		case "anthropic":
			return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(model);
		case "openai":
			return createOpenAI({ apiKey: env.OPENAI_API_KEY })(model);
		case "cerebras":
			return createCerebras({ apiKey: env.CEREBRAS_API_KEY })(model);
	}
}

export const supervisorModel: LanguageModel = resolveModel(
	env.SUPERVISOR_PROVIDER,
	env.SUPERVISOR_MODEL,
);

// Only create a distinct child model when CHILD_PROVIDER/CHILD_MODEL are set.
// Otherwise leave undefined so runAgent defaults to the supervisor model.
export const childModel: LanguageModel | undefined =
	env.CHILD_PROVIDER !== env.SUPERVISOR_PROVIDER || env.CHILD_MODEL
		? resolveModel(
				env.CHILD_PROVIDER,
				env.CHILD_MODEL || DEFAULTS[env.CHILD_PROVIDER],
			)
		: undefined;
