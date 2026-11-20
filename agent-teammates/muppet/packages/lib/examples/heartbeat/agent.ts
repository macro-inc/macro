import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeCode } from "../../agents/claude-code.ts";
import type { Agent } from "../../core/agent.ts";
import { scheduleControl } from "../../utilities/schedules/index.ts";
import { journal } from "./capabilities.ts";
import { stop } from "./context.ts";

const behaviorFile = join(import.meta.dir, "behavior.ts");

const standInBeats = 3;

/**
 * Stands in for Claude: on each heartbeat, reads its notes and leaves one
 * through code mode the way the agent would, and stops the agent after a few.
 */
const standIn = (): Agent => {
	let beats = 0;
	return {
		wake: async ({ request, systemPrompt, state }) => {
			beats += 1;
			console.log(`\n--- ${request}`);
			console.log(systemPrompt.slice(systemPrompt.lastIndexOf("# Pulse")));
			console.log(
				"ExecuteCode:",
				await state.code.execute(`
import type { Script } from ${JSON.stringify(behaviorFile)};
import { listSchedules } from ${JSON.stringify(scheduleControl.file)};
import { writeNote } from ${JSON.stringify(journal.file)};

export async function main({ context, log }: Script) {
	const schedules = await listSchedules(context);
	log(schedules.map(({ name, when, next }) => \`\${name}: \${when}, next \${next}\`).join("\\n"));
	return await writeNote(context, { text: "Heartbeat ${beats}: all quiet." });
}
`),
			);
			if (beats === standInBeats) stop.abort();
			return { kind: "done", reply: `Heartbeat ${beats} noted.` };
		},
	};
};

/** Real Claude Code when MUPPET_CLAUDE is set, otherwise the stand-in. */
export const agent: Agent = process.env.MUPPET_CLAUDE
	? claudeCode({ query })
	: standIn();
