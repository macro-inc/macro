/**
 * bin/agent: the agent from the command line.
 *
 *   bin/agent run                     run the agent: listen for events until stopped
 *   bin/agent list                    its catalog, one line per capability
 *   bin/agent describe <name>...      full docs of capabilities, or of single functions
 *   bin/agent <function> [json|-]     call a function of a capability; its output is printed as JSON
 *   bin/agent exec <file|->           type-check and run a code-mode script, as ExecuteCode does
 *   bin/agent guard                   a Claude Code PreToolUse hook: hold a tool call to the agent's guards
 *
 * A function called here runs in its own process, with the same context and
 * state as the running agent, so anything it can do in a wake, or a
 * person can do from a shell. It is called by a one-line script, so its JSON
 * input is type-checked like any script's: a mistyped flag, or input the
 * function doesn't take, is refused before anything runs.
 */
import { describe, moduleOf, summarize } from "@muppet/lib/core/capability";
import { calling, execute } from "@muppet/lib/core/code";
import { parallel } from "@muppet/lib/runtimes/parallel";
import { z } from "zod";
import { guards } from "./behavior/agent/guards/index.ts";
import { refusal } from "./behavior/agent/guard.ts";
import { macroKey } from "./behavior/context/index.ts";
import { stayOnline } from "./behavior/capabilities/chat/presence.ts";
import { ensureMailSchedules } from "./behavior/capabilities/mail/schedule.ts";
import { ensureSchedules } from "./behavior/capabilities/heartbeat/schedules.ts";
import { ensureHomeDashboard } from "./behavior/capabilities/dashboard/index.ts";
import { ensureIntroduction } from "./behavior/events/handlers/identity.ts";
import { assistant, base, scripts } from "./index.ts";

const usage =
	"usage: bin/agent <run|list|describe|exec|guard|function> [input]";
const presenceLog = "presence";
const openState = 1;

const [command, ...rest] = process.argv.slice(2);

/** An argument, or all of stdin when it is `-`. Never stdin unasked: a hook or a script leaves it open, and the read would wait forever. */
const input = async (argument: string | undefined): Promise<string> =>
	argument === "-" ? await Bun.stdin.text() : (argument ?? "");

const print = (value: unknown): void => {
	console.log(
		typeof value === "string" ? value : JSON.stringify(value, null, 2),
	);
};

const fail = (message: string): never => {
	console.error(message);
	process.exit(1);
};

const Hook = z.object({
	tool_name: z.string(),
	tool_input: z.unknown(),
	cwd: z.string(),
});

const run = async (): Promise<void> => {
	// The agent shows online in Macro for as long as it runs.
	const apiKey = await base.credentials.get(macroKey);
	stayOnline({
		open: () => {
			const socket = new WebSocket(base.config.gateway, {
				headers: { "x-macro-user-api-key": apiKey },
			});
			return {
				send: (data) => socket.send(data),
				isOpen: () => socket.readyState === openState,
				onOpen: (handle) => socket.addEventListener("open", handle),
				onClose: (handle) =>
					socket.addEventListener("close", ({ code, reason }) =>
						handle(code, reason),
					),
			};
		},
		log: (entry) => void base.log.event(presenceLog, entry),
	});
	await ensureMailSchedules(assistant.decorations.schedules);
	// The standing schedules exist before anything fires; ones the agent changed are left alone.
	await ensureSchedules(assistant.decorations.schedules);
	// A new agent's first wake is to ask its owner who it is.
	await ensureIntroduction(base, assistant.decorations.schedules);
	// A new agent's page in Macro shows a default dashboard until it makes its own.
	await ensureHomeDashboard(base).catch((error: unknown) =>
		base.log.event("dashboard", { kind: "failed", error: String(error) }),
	);
	await assistant.run(
		parallel({
			systemPrompt: (await base.disk.read(base.config.charter)) ?? "",
			...scripts,
		}),
	);
};

switch (command) {
	case undefined:
		fail(usage);
		break;
	case "run":
		await run();
		break;
	case "list":
		print(summarize(assistant.capabilities));
		break;
	case "describe":
		print(await describe(assistant.capabilities, rest, scripts.signatures));
		break;
	case "exec": {
		const [file] = rest;
		const source =
			file === undefined || file === "-"
				? await Bun.stdin.text()
				: await Bun.file(file).text();
		const executed = await execute(assistant.decorations, scripts.load)(source);
		print(executed);
		process.exit(executed.kind === "succeeded" ? 0 : 1);
		break;
	}
	case "guard": {
		const hook = Hook.safeParse(JSON.parse(await Bun.stdin.text()));
		const reason = hook.success
			? refusal(guards, {
					tool: hook.data.tool_name,
					input: hook.data.tool_input,
					cwd: hook.data.cwd,
					environment: process.env,
				})
			: undefined;
		if (reason !== undefined)
			print({
				hookSpecificOutput: {
					hookEventName: "PreToolUse",
					permissionDecision: "deny",
					permissionDecisionReason: reason,
				},
			});
		process.exit(0);
		break;
	}
	default: {
		const owner = moduleOf(assistant.capabilities, command);
		if (owner === undefined) {
			const capability = assistant.capabilities[command];
			fail(
				capability === undefined
					? `${command} is not a function of a capability, or a command\n${usage}`
					: `${command} is a ${capability.kind}, not a function: ${capability.summary}`,
			);
			break;
		}
		const text = (await input(rest[0])).trim();
		const executed = await execute(
			assistant.decorations,
			scripts.load,
		)(
			calling(
				scripts.script,
				{ file: owner.file, name: command },
				text === "" ? undefined : JSON.parse(text),
			),
		);
		if (executed.kind === "failed")
			fail(`${command} failed: ${executed.error}`);
		else print(executed.output);
		process.exit(0);
	}
}
