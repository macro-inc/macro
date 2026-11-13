/**
 * Fitting a trace under an upload limit. Macro takes at most 10 MiB of JSON
 * for one wake's trace, so a trace that is bigger loses detail, least useful
 * first, until it fits: tool results and thinking are cut shorter, then every
 * text and tool input, and last the oldest spans go (the prompt stays), with
 * a span in their place saying how many. Whatever is cut says so in its text.
 */
import { capText, type Span, type WakeTrace } from "./trace.ts";

/** The most bytes of JSON Macro takes for one wake's trace. */
export const traceLimit = 10 * 1024 * 1024;

const encoder = new TextEncoder();

/** The size of `trace` as UTF-8 JSON, in bytes. */
export const traceBytes = (trace: WakeTrace): number =>
	encoder.encode(JSON.stringify(trace)).length;

const capInput = (input: unknown, limit: number): unknown => {
	const json = JSON.stringify(input);
	return typeof json === "string" && json.length > limit
		? capText(json, limit)
		: input;
};

/** Cuts the bulky parts of a span: tool results and thinking, or (`all`) every text and the tool input too. */
const shorten =
	(limit: number, all: boolean) =>
	(span: Span): Span => {
		if (span.kind === "tool")
			return {
				...span,
				...(span.result === undefined
					? {}
					: { result: capText(span.result, limit) }),
				...(all ? { input: capInput(span.input, limit) } : {}),
			};
		if (span.kind === "turn")
			return {
				...span,
				thinking: capText(span.thinking, limit),
				...(all ? { text: capText(span.text, limit) } : {}),
			};
		return all ? { ...span, text: capText(span.text, limit) } : span;
	};

const steps: readonly ((span: Span) => Span)[] = [
	shorten(20_000, false),
	shorten(2_000, false),
	shorten(2_000, true),
];

/** The trace without its `count` oldest spans after the prompt, and a span saying so in their place. */
const withoutOldest = (trace: WakeTrace, count: number): WakeTrace => {
	if (count === 0) return trace;
	const [first, ...rest] = trace.spans;
	if (first === undefined) return trace;
	const keep = first.kind === "user" ? [first] : [];
	const from = first.kind === "user" ? rest : trace.spans;
	const dropped = from.slice(0, count);
	const marker: Span = {
		kind: "user",
		at: dropped[0]?.at ?? first.at,
		text: `[${dropped.length} earlier spans cut to fit the upload limit]`,
	};
	return { ...trace, spans: [...keep, marker, ...from.slice(count)] };
};

/**
 * `trace`, cut until its JSON is at most `limit` bytes. A trace that fits is
 * returned as it is. If even a prompt alone doesn't fit, what is returned has
 * no spans at all.
 */
export const fitTrace = (
	trace: WakeTrace,
	limit: number = traceLimit,
): WakeTrace => {
	if (traceBytes(trace) <= limit) return trace;
	let fitted = trace;
	for (const step of steps) {
		fitted = { ...fitted, spans: fitted.spans.map(step) };
		if (traceBytes(fitted) <= limit) return fitted;
	}
	// The fewest oldest spans to drop, by bisection: dropping more never makes it bigger.
	let low = 1;
	let high = fitted.spans.length;
	if (traceBytes(withoutOldest(fitted, high)) > limit)
		return { ...fitted, spans: [] };
	while (low < high) {
		const middle = Math.floor((low + high) / 2);
		if (traceBytes(withoutOldest(fitted, middle)) <= limit) high = middle;
		else low = middle + 1;
	}
	return withoutOldest(fitted, low);
};
