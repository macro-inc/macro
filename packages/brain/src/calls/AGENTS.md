# Calls

Voice sessions for agent teammates. `turns.ts` is pure; `ear.ts` owns local
endpointing and exactly-once rescue delivery; `call.ts` wires streaming model,
speech and playback interfaces; `join.ts` owns LiveKit resources. `watch.ts`
selects calls through the agent's own Macro access.

## Checks

Run `deno task test` and `deno task check` from `packages/brain`. Tests use
synthetic quiet-mic WAVs and injected speech, never provider credentials.
Native media requires the compiled runner's scoped Node-API permission.

## Contracts

Keep call transports behind `Brain`, `Speaker`, `SttFactory`, `TtsFactory` and
`CallApi`. Send speech through the computer gateway with agent-key auth.
Use the brain's memory/writer and work tier for summaries and hand-offs.
Local diagnostics contain speech and audio: keep them under ignored `log/`,
private, bounded and pruned. Export categories/counts only to telemetry.
