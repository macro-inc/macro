import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { behavior, type ContextOf } from "../../core/behavior.ts";
import type { Files, StatePaths } from "../../core/state.ts";
import type { Clock } from "../../utilities/time/index.ts";

// This agent's state layout. A fresh directory per run unless MUPPET_STATE is
// set; set it to keep the journal and the heartbeat across runs.
const root =
	process.env.MUPPET_STATE ?? (await mkdtemp(join(tmpdir(), "muppet-")));
const sharedDirectory = "shared";
const capabilitiesDirectory = "capabilities";

export const state: StatePaths = {
	shared: join(root, sharedDirectory),
	capability: (name) => join(root, capabilitiesDirectory, name),
};

export const files: Files = {
	read: (path) => readFile(path, "utf8").catch(() => undefined),
	write: async (path, text) => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text);
	},
};

export const clock: Clock = {
	now: () => Temporal.Now.instant(),
	sleep: (ms) => Bun.sleep(ms),
};

/** Aborted on Ctrl-C, which ends the heartbeat and so the agent. */
export const stop = new AbortController();
process.once("SIGINT", () => stop.abort());

export const context = behavior().decorate({ state, files, clock });

export type Context = ContextOf<typeof context>;
