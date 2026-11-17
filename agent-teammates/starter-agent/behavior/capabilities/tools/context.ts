import { behavior, type ContextOf } from "@muppet/lib/core/behavior";
import type { Base } from "../../context/index.ts";
import { toolsConfig } from "./config.ts";
import type { Random } from "./secrets.ts";

const random: Random = {
	bytes: (count) => crypto.getRandomValues(new Uint8Array(count)),
};

/** What the tools add to the agent's context: their limits, and randomness for new passwords. */
export const toolsContext = (_base: Base) =>
	behavior<Base>().decorate({
		tools: toolsConfig(),
		random,
	});

export type ToolsContext = ContextOf<ReturnType<typeof toolsContext>>;
