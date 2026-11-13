/**
 * Traces: a wake's model session as Macro shows it. A Claude Code transcript
 * or a Codex rollout, read as parsed JSON Lines by whoever has the file, is
 * turned into a `WakeTrace` (`wakeTrace`): what was said to the session,
 * each model turn with its tokens, and each tool call with its result.
 * Everything in it is redacted on the way in (`redactor`), each text is cut
 * at 200,000 characters, and `fitTrace` cuts the whole until its JSON is under
 * Macro's 10 MiB limit:
 *
 *     const redact = redactor(await credentialValues(credentials)());
 *     const trace = wakeTrace({ lines, live: false, redact });
 *     if (trace !== undefined) await upload(fitTrace(trace));
 *
 * `macroSink` in `utilities/telemetry` does all of this for every wake. The
 * format is in `../telemetry/FORMAT.md`.
 */
export { fitTrace, traceBytes, traceLimit } from "./fit.ts";
export { credentialValues, type Redactor, redactor } from "./redact.ts";
export {
	claudeTrace,
	codexTrace,
	type Span,
	sessionHead,
	type Tokens,
	type TraceInput,
	type TraceSource,
	textLimit,
	traceVersion,
	type WakeTrace,
	wakeTrace,
} from "./trace.ts";
