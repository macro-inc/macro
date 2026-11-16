/**
 * The agent's entrypoint: make sure it has a heartbeat, then run its
 * behavior until Ctrl-C. Run with `bun examples/heartbeat/index.ts`, with
 * MUPPET_HEARTBEAT to beat at another rate than 30m (e.g. 5s), and with
 * MUPPET_CLAUDE=1 to wake real Claude Code. The stand-in stops after three
 * heartbeats.
 */
import { join } from "node:path";
import { simple } from "../../runtimes/simple.ts";
import { scripts } from "../scripts.ts";
import { heartbeat, pulse, scheduled } from "./behavior.ts";

const directory = import.meta.dir;
const agentFile = "AGENT.md";
const behaviorFile = "behavior.ts";
// The heartbeat is state, not code, so the agent can change its own rate.
// Only add it if it isn't there, or a restart would undo the agent's change.
const { schedules } = scheduled.decorations;
if (!(await schedules.list()).some(({ name }) => name === heartbeat)) {
	const added = await schedules.set(heartbeat, {
		every: process.env.MUPPET_HEARTBEAT ?? "30m",
		why: "Wakes Pulse to check in.",
	});
	if (added.kind === "invalid") throw new Error(added.error);
}

await pulse.run(
	simple({
		systemPrompt: await Bun.file(join(directory, agentFile)).text(),
		...scripts(directory, {
			file: join(directory, behaviorFile),
			name: "Script",
		}),
	}),
);
