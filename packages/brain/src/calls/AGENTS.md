# Calls

Voice sessions for agent teammates. `turns.ts` is pure; `ear.ts` owns local
endpointing and exactly-once rescue delivery; `call.ts` wires streaming model,
speech and playback interfaces; `join.ts` owns LiveKit resources. `watch.ts`
selects calls through the agent's own Macro access.

## Checks

Run `npm test` and `npm run check` from `packages/brain`. Tests use
synthetic quiet-mic WAVs and injected speech, never provider credentials.
LiveKit runs natively on Node 24; the image ships the platform addon offline.

## Contracts

Keep call transports behind `Brain`, `Speaker`, `SttFactory`, `TtsFactory` and
`CallApi`. Send speech through the computer gateway with agent-key auth.
Use the brain's memory/writer and work tier for summaries and hand-offs.
Local diagnostics contain speech and audio: keep them under ignored `log/`,
private, bounded and pruned. Export categories/counts only to telemetry.

Use the pinned `@livekit/agents` inference primitives through Macro's agent-key
proxy; retain local turn-taking and never give the VM LiveKit project secrets.
Rescue finalizes a fresh stream for unresolved PCM because the SDK has no batch
recognition. Barge-in terminates the turn's TTS sockets because Inference has no
Clear command. Keep these capability differences in the package README.
