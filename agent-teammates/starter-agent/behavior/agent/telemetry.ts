/**
 * Wake telemetry: every wake is recorded to the agent account's wakes in
 * Macro, with its Claude Code session as a redacted trace, so its owner can
 * watch what it does and why (the wakes and trace panes of an agent's
 * dashboard). It is on whenever the agent has its Macro API key.
 *
 * Macro answers 404 while agent dashboards are off for the account: the sink
 * then sends nothing more until the agent restarts. Nothing here ever fails a
 * wake: a slow or down Macro costs records and traces, and a trace whose
 * credentials can't all be read for redaction is not sent.
 */
import type { EventContext, WakeContext } from "@muppet/lib/core/agent";
import {
	defineOutcomes,
	macroSink,
	type Session,
	type Trigger,
	type WakeClient,
	WakesUnavailable,
	wakeTelemetry,
} from "@muppet/lib/utilities/telemetry";
import { credentialValues } from "@muppet/lib/utilities/traces";
import type { Base } from "../context/index.ts";
import { macroKey } from "../context/index.ts";
import type { ClaudeAgent } from "./claude.ts";

/** The system the agent's wakes are recorded under. A label: the same for every agent made from this template. */
export const system = "starter-agent";

/**
 * What came of a wake. The agent reports none (the starter has no
 * `reportOutcome`), so every wake is recorded as `unclassified`; an agent that
 * wants outcomes declares them here and gives itself the capability.
 */
const outcomes = defineOutcomes()({});

/** The header a Macro API key is sent in. */
const apiKeyHeader = "x-macro-user-api-key";

/** Requests to Macro: `fetch`, injected. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The wake routes of Macro's agent harness, as the agent account `me`,
 * authenticated with the key `key` reads (asked on every request, so a
 * rotated key is used). With no key, or a 404 for a record (the routes are
 * off for this account), it throws `WakesUnavailable`.
 */
export const wakeClient = ({
	harness,
	me,
	key,
	fetch,
}: {
	readonly harness: string;
	readonly me: string;
	readonly key: () => Promise<string | undefined>;
	readonly fetch: Fetch;
}): WakeClient => {
	const wakes = `${harness}/agents/${encodeURIComponent(me)}/wakes`;
	const send = async (
		method: string,
		url: string,
		body: unknown,
		signal: AbortSignal | undefined,
	): Promise<Response> => {
		const apiKey = await key();
		if (apiKey === undefined)
			throw new WakesUnavailable("the agent has no Macro API key");
		return fetch(url, {
			method,
			headers: { [apiKeyHeader]: apiKey, "content-type": "application/json" },
			body: JSON.stringify(body),
			...(signal === undefined ? {} : { signal }),
		});
	};
	return {
		recordWake: async (record, signal) => {
			const response = await send("POST", wakes, record, signal);
			if (response.status === 404) throw new WakesUnavailable();
			if (!response.ok)
				throw new Error(`recording a wake: Macro answered ${response.status}`);
		},
		uploadTrace: async (wake, trace, signal) => {
			const response = await send(
				"PUT",
				`${wakes}/${encodeURIComponent(wake)}/trace`,
				trace,
				signal,
			);
			if (!response.ok)
				throw new Error(`uploading a trace: Macro answered ${response.status}`);
		},
	};
};

/**
 * A Claude Code session's transcript, each JSON line parsed, from wherever
 * Claude Code keeps it under `home` (`~/.claude/projects/<project>/<id>.jsonl`),
 * or undefined while there is none. A line that isn't JSON is left out.
 */
export const claudeTranscript =
	({ home, disk, join }: Pick<Base, "disk" | "join"> & { home: string }) =>
	async (session: Session): Promise<readonly unknown[] | undefined> => {
		if (session.id === undefined) return undefined;
		const projects = join(home, ".claude", "projects");
		for (const project of await disk.list(projects)) {
			const text = await disk.read(
				join(projects, project, `${session.id}.jsonl`),
			);
			if (text === undefined) continue;
			return text.split("\n").flatMap((line): unknown[] => {
				if (line.trim() === "") return [];
				try {
					return [JSON.parse(line)];
				} catch {
					return [];
				}
			});
		}
		return undefined;
	};

/** What woke the agent, from the event that did: a schedule, a message, or anything else. */
export const trigger = (event: EventContext): Trigger => ({
	kind: /schedul|heartbeat|later|tick|due/i.test(event.name)
		? "schedule"
		: /message|chat|mail|call|repl|dm/i.test(event.name)
			? "message"
			: "event",
	source: event.name,
	ids: {},
});

/**
 * `claude` with every wake recorded to Macro (see the top of this file). The
 * wake's system prompt is left as it is: the starter declares no outcomes to
 * report.
 */
export const recordedAgent = (
	base: Pick<Base, "config" | "credentials" | "clock" | "disk" | "join">,
	claude: ClaudeAgent,
	fetch: Fetch,
) => {
	const { config, credentials, clock } = base;
	const telemetry = wakeTelemetry({
		system,
		outcomes,
		clock,
		id: () => crypto.randomUUID(),
		hex: (bytes) =>
			[...crypto.getRandomValues(new Uint8Array(bytes))]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join(""),
		instructions: () => "",
		sinks: [
			macroSink({
				client: wakeClient({
					harness: config.harness,
					me: config.me,
					key: async () =>
						(await credentials.has(macroKey))
							? credentials.get(macroKey)
							: undefined,
					fetch,
				}),
				clock,
				traces: {
					transcript: claudeTranscript({ ...base, home: config.home }),
					secrets: credentialValues(credentials),
				},
			}),
		],
	});
	return telemetry.agent({
		trigger,
		wake: ({ systemPrompt, ...wake }: WakeContext, observe) =>
			claude.wake(
				// `instructions` is empty, so drop the separator it was joined with.
				{ ...wake, systemPrompt: systemPrompt.replace(/\n\n$/, "") },
				observe,
			),
	});
};
