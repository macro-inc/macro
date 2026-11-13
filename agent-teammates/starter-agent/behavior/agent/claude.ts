import {
	createSdkMcpServer,
	type query,
	tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { EventContext, WakeContext, Woke } from "@muppet/lib/core/agent";
import type { Wake } from "@muppet/lib/utilities/telemetry";
import { z } from "zod";
import { type Guard, refusal } from "./guard.ts";

const server = "agent";

/** How one wake is run: what it may spend, how long it may take, and where it works. */
export type Profile = {
	readonly budgetUsd: number;
	readonly timeoutMs: number;
	readonly cwd: string;
	/** Other directories the run may work in. */
	readonly directories: readonly string[];
};

/** What a wake tells its telemetry as it learns it: the session it runs as, what it spent, and why it failed. */
export type Observer = Pick<
	Wake<string, string>,
	"session" | "usage" | "error"
>;

/** An agent whose wake can be observed (`behavior/agent/telemetry.ts`); unobserved, it is an ordinary muppet `Agent`. */
export type ClaudeAgent = {
	readonly wake: (wake: WakeContext, observe?: Observer) => Promise<Woke>;
};

/**
 * The agent as Claude Code, through the Claude Agent SDK. Like lib's
 * `claudeCode`, each wake is one session with the code-mode tools, and on top
 * of that it pins the model, runs as the agent and nobody else, holds every
 * tool call to the guards, and ends a wake at its budget or its time limit.
 */
export const agentClaude = ({
	query: run,
	model,
	profile,
	environment,
	after,
	guards,
	record,
}: {
	/** The SDK's `query`, injected. */
	readonly query: typeof query;
	readonly model: string;
	/** Chooses how a wake is run from the event that led to it. */
	readonly profile: (event: EventContext) => Profile;
	/** The whole environment a run gets, which makes git and gh act as the agent. An undefined value is a variable the run must not have. */
	readonly environment: () => Promise<
		Readonly<Record<string, string | undefined>>
	>;
	/** Calls `run` after this long, unless the returned function is called first. */
	readonly after: (milliseconds: number, run: () => void) => () => void;
	readonly guards: readonly Guard[];
	/** Receives a line when a wake starts and one when it ends, for the log. */
	readonly record: (entry: object) => Promise<void>;
}): ClaudeAgent => ({
	wake: async ({ request, systemPrompt, event, state }, observe) => {
		const capabilities = createSdkMcpServer({
			name: server,
			tools: [
				tool(
					"ExecuteCode",
					"Type-check a TypeScript module that exports `async function main({ context, log })`, then run it inside your running process, and get back what main returned and everything it passed to log, or the type errors that kept it from running. Use it to use your capabilities.",
					{ source: z.string() },
					async ({ source }) => {
						const executed = await state.code.execute(source);
						return {
							content: [{ type: "text", text: JSON.stringify(executed) }],
							isError: executed.kind === "failed",
						};
					},
				),
				tool(
					"DescribeCapabilities",
					"Read the full docs of capabilities in your catalog, or of single functions by name, several at once.",
					{ names: z.array(z.string()) },
					async ({ names }) => ({
						content: [{ type: "text", text: await state.code.describe(names) }],
					}),
				),
			],
		});

		const { budgetUsd, timeoutMs, cwd, directories } = profile(event);
		const env = Object.fromEntries(
			Object.entries(await environment()).flatMap(([name, value]) =>
				value === undefined ? [] : [[name, value]],
			),
		);
		const abort = new AbortController();
		let late = false;
		let session: string | undefined;
		const cancel = after(timeoutMs, () => {
			late = true;
			abort.abort();
		});

		const prompt = [
			request,
			`This was prompted by a "${event.name}" event:`,
			JSON.stringify(event.payload, null, 2),
		].join("\n\n");

		try {
			for await (const message of run({
				prompt,
				options: {
					model,
					cwd,
					additionalDirectories: [...directories],
					maxBudgetUsd: budgetUsd,
					abortController: abort,
					env,
					mcpServers: { [server]: capabilities },
					systemPrompt: {
						type: "preset",
						preset: "claude_code",
						append: systemPrompt,
					},
					// Only what is passed here: the machine's own Claude settings belong to its user's sessions.
					settingSources: [],
					hooks: {
						PreToolUse: [
							{
								hooks: [
									async (input) => {
										if (input.hook_event_name !== "PreToolUse") return {};
										const reason = refusal(guards, {
											tool: input.tool_name,
											input: input.tool_input,
											cwd: input.cwd,
											environment: env,
											event,
										});
										return reason === undefined
											? {}
											: {
													hookSpecificOutput: {
														hookEventName: "PreToolUse",
														permissionDecision: "deny",
														permissionDecisionReason: reason,
													},
												};
									},
								],
							},
						],
					},
					// The agent runs unattended, so nothing waits on approval; the guards are the limit.
					permissionMode: "bypassPermissions",
					allowDangerouslySkipPermissions: true,
				},
			})) {
				// The session id ties this wake to its transcript, so it can be traced while it runs.
				if (message.type === "system" && message.subtype === "init") {
					session = message.session_id;
					observe?.session({ agent: "claude", id: session, model });
					await record({
						event: event.name,
						phase: "start",
						session_id: session,
					});
				}
				if (message.type === "result") {
					observe?.usage({
						costUsd: message.total_cost_usd,
						turns: message.num_turns,
						inputTokens: message.usage.input_tokens,
						outputTokens: message.usage.output_tokens,
					});
					await record({
						event: event.name,
						session_id: message.session_id,
						result: message.subtype,
						cost_usd: message.total_cost_usd,
						turns: message.num_turns,
						ms: message.duration_ms,
					});
					return message.subtype === "success"
						? { kind: "done", reply: message.result }
						: { kind: "failed", error: message.subtype };
				}
			}
			return { kind: "failed", error: "session ended without a result" };
		} catch (error) {
			if (!late) throw error;
			observe?.error("timeout");
			await record({
				event: event.name,
				session_id: session,
				result: "timeout",
				ms: timeoutMs,
			});
			return { kind: "failed", error: `timed out after ${timeoutMs}ms` };
		} finally {
			cancel();
		}
	},
});
