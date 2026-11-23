/**
 * The wake record as OpenTelemetry attributes, the same on its log record
 * and its span.
 *
 * The names follow the GenAI semantic conventions where they fit, as of
 * open-telemetry/semantic-conventions-genai at 2026-11-06 (all still in
 * Development): the span is their "invoke agent internal" span, named
 * `invoke_agent {gen_ai.agent.name}`, with `gen_ai.operation.name`
 * (`invoke_agent`, or `invoke_workflow` for work the system's code did
 * without a model), `gen_ai.agent.name` (the system),
 * `gen_ai.conversation.id` (the session id), `gen_ai.request.model`,
 * `gen_ai.usage.input_tokens`/`output_tokens` and `error.type`.
 * `gen_ai.provider.name` is kept although the convention no longer asks for
 * it on this span. `session.id` repeats the session id under the name Claude
 * Code's own telemetry uses, so the two join. Everything the conventions
 * have no name for is under `muppet.`.
 */
import type { WakeRecord } from "./record.ts";

/** The `service.namespace` every muppet system reports under, beside its own `service.name`. */
export const namespace = "muppet";

export type Value = string | number | boolean | readonly string[];

/** A record's attributes, the same on its log record and its span. */
export const attributes = (
	record: WakeRecord,
): Readonly<Record<string, Value>> => {
	const { trigger, session, parent } = record;
	const optional = (
		entries: Readonly<Record<string, Value | undefined>>,
	): Readonly<Record<string, Value>> =>
		Object.fromEntries(
			Object.entries(entries).flatMap(([key, value]) =>
				value === undefined ? [] : [[key, value]],
			),
		);
	return optional({
		"event.name": `muppet.wake.${record.phase}`,
		"muppet.schema": record.v,
		"muppet.system": record.system,
		"muppet.wake.id": record.wake,
		"muppet.wake.phase": record.phase,
		"muppet.wake.parent.id": parent?.wake,
		"muppet.wake.parent.system": parent?.system,
		"muppet.wake.started_at": record.startedAt,
		"muppet.trigger.kind": trigger.kind,
		"muppet.trigger.source": trigger.source,
		"muppet.trigger.name": trigger.name,
		"muppet.trigger.summary": trigger.summary,
		...Object.fromEntries(
			Object.entries(trigger.ids).map(([name, id]) => [
				`muppet.trigger.id.${name}`,
				id,
			]),
		),
		"muppet.herdr.terminal": record.terminal,
		"gen_ai.operation.name": record.operation ?? "invoke_agent",
		"gen_ai.agent.name": record.system,
		"gen_ai.conversation.id": session?.id,
		"session.id": session?.id,
		"gen_ai.provider.name": session?.provider,
		"gen_ai.request.model": session?.model,
		"muppet.agent.kind": session?.agent,
		...(record.phase === "end"
			? {
					"muppet.wake.ended_at": record.endedAt,
					"muppet.wake.duration_ms": record.durationMs,
					"muppet.wake.status": record.status,
					"error.type": record.error?.type,
					"error.message": record.error?.message,
					"muppet.outcome.name": record.outcome.name,
					"muppet.outcome.source": record.outcome.source,
					"muppet.outcome.check": record.outcome.check,
					"muppet.outcome.reported": record.outcome.reported,
					"muppet.outcome.observed": record.outcome.observed,
					"muppet.outcome.summary": record.outcome.summary,
					"muppet.effects": record.effects.map(({ kind, id }) =>
						id === undefined ? kind : `${kind}:${id}`,
					),
					"gen_ai.usage.input_tokens": record.usage?.inputTokens,
					"gen_ai.usage.output_tokens": record.usage?.outputTokens,
					"muppet.usage.cost_usd": record.usage?.costUsd,
					"muppet.usage.turns": record.usage?.turns,
				}
			: {}),
	});
};

/** The record in one line, for a person reading the log. */
export const line = (record: WakeRecord): string => {
	const { trigger } = record;
	const why = [trigger.kind, trigger.source, trigger.name]
		.filter((part) => part !== undefined)
		.join(" ");
	return record.phase === "end"
		? `${record.system} wake ${record.wake} ${record.status}: ${record.outcome.name} (${why})`
		: `${record.system} wake ${record.wake} ${record.phase} (${why})`;
};
