import { envsafe, makeValidator, num, str } from "envsafe";

const provider = makeValidator<"anthropic" | "openai" | "cerebras">((input) => {
	if (input === "anthropic" || input === "openai" || input === "cerebras")
		return input;
	throw new Error(`must be one of: anthropic, openai, cerebras`);
});

export const env = envsafe({
	PORT: num({ devDefault: 8932 }),
	SYNC_WS_BASE: str({
		devDefault: "ws://localhost:8787",
	}),

	SUPERVISOR_PROVIDER: provider({ devDefault: "anthropic" }),
	SUPERVISOR_MODEL: str({ allowEmpty: false, devDefault: "claude-sonnet-4-6" }),

	CHILD_PROVIDER: provider({ allowEmpty: true, devDefault: "anthropic" }),
	CHILD_MODEL: str({ allowEmpty: true, devDefault: "" }),

	ANTHROPIC_API_KEY: str(),
	OPENAI_API_KEY: str({ allowEmpty: true, devDefault: "" }),
	CEREBRAS_API_KEY: str({ allowEmpty: true, devDefault: "" }),
});
