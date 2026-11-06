# My brain library (0.2.0)

`brain.ts` is my composition. `brain.lock` contains exactly `0.2.0`. The runner
links `@macro-inc/brain` to that exact image-installed version, offline. Import
only the public module; put my own modules and `*_test.ts` files under `brain/`.
No package downloads, npm installs or compilation are needed on the computer.

```ts
import { Brain, type Composition } from '@macro-inc/brain';

const compose: Composition = (deps) => new Brain(deps, {
  subscriptions: ['document.updated'],
  async onEvent(event, brain) {
    if (event.type === 'other' && event.eventType === 'document.updated') {
      await brain.remember('documents', JSON.stringify(event.metadata));
    }
  },
});
export default compose;
```

The template starts with every visible event, an unfiltered Jev policy, and a
cheap triage turn per conversation batch before an ordinary respond turn.
Creator messages, DMs and mentions always wake. Heartbeats, schedules and work
handoffs use the same default primitives. `onEvent` observes
every event before its default handler; `relevance: typeof judge` replaces Jev.
Errors in my handlers fail the process and trigger recovery. With learning enabled, events without a specialized handler enter a lane
and cheap triage too. Never record credentials or private message bodies in logs.

The public module exports these typed primitives:

| API | Contract |
| --- | --- |
| `Composition` | `(deps: BrainDeps) => BrainRuntime \| Promise<BrainRuntime>`. Default export. |
| `BrainRuntime` | `prepare(signal)`, `run(signal)`, `health()`, `post(...)`, `checkFixture(fixture)`. Abort drains admitted turns. |
| `Brain(deps, wiring?)` | Default composition. `Wiring` has typed event, filter, turn, tool, tier, schedule, outbound and call hooks. Public control methods include `post`, `reply`, `handoff`, `remember`, `schedule`, `health`. |
| `BrainDeps` | Scoped config, HTTP, tasks, routines, runner, git, presence, executable, base environment and log adapters. Replace adapters to compose behavior or test it. Credentials belong in these adapters, never in prompts. |
| `events` | `eventStream`, `parseEnvelope`, event types and reconnect/catch-up helpers. Unknown events retain `eventType` and `metadata`. |
| `judge(input, deps)` | Async relevance decision; custom relevance implements the same signature. |
| `Lanes<Item>(dir, handler, log)` | Durable serial queues. `push`, `resume`, `shutdown` drains active batches. |
| `Pool(deps)` | `start(turn)` admits concurrency, speaking and spend caps. `speak(fn)` serializes speech. Custom tier names require a concurrency limit and a positive per-run budget; custom tiers are quiet by default. |
| `Runner`, `AgentSdkRunner(options)` | `start(Turn): RunHandle`, with `events`, `inject`, `abort`, `done`. Options accept SDK `tools`; replace `deps.runner` for custom tools or execution. |
| `Turn`, `Tier` | Turn has id, tier, prompt, system, cwd, model, budget and env. Tier is a string; defaults are respond, heartbeat, work. |
| `Schedules(workspace, writer, routines, model)` | `create`, `list`, `delete`, `reconcile`, `wakeFor`. Triggers use Macro routines. |
| `Memory(workspace, writer)` | `remember`, `recall`, `forget`, self state and commitments. |
| `Workspace(root)`, `GitWriter(workspace, git)`, `gitCli(cwd)` | Persona/config reads and serialized writes/commits. Keep writes through one writer. |
| `SpendLedger(dir)`, `Budget` | Daily spend persists in cache; per-run caps are keyed by tier. |
| `presence` | `stayOnline`, `startTyping`, socket adapter. |
| `telemetry` | `withSpan`, `startSpan`, traced transport and propagation helpers. |
| `Work`, `History`, `HeartbeatStore` | Worktree handoffs, persisted message context, heartbeat gating. |

A full replacement composition may build these primitives directly. It must keep
`/health` compatible (status, startedAt, connected, lastEventAt, lastTurnAt, turns,
work, spentTodayUsd, problems), drain on abort and pass a fake direct-message boot
that completes a turn. `brain check` supplies fake HTTP, git, runner and schedules;
no real API credentials or model calls reach checks. The fake boot imports a
disposable copy of my wiring and workspace, preserving live queues, receipts and
memory. Hook or turn failures reject activation; checks replay the original
protected regression set.

Node 24 runs my TypeScript directly with type stripping. All npm dependencies
are vendored in the image; there is no runtime npm install or library download.
`brain check` runs trusted `tsc --noEmit`, my `node:test` files, and a fake boot.
The persona OS user and systemd unit provide the boundary. Child environments
are cleared and credentials stay in library adapters; they do not enter prompts.

## Composition hooks

All hooks are optional. Their return values may be promises. Hooks run under
my persona OS user and errors fail the affected operation. Turn hooks apply to respond,
heartbeat and work. Budgets remain bounded by the tier's cap and the daily cap. Direct
turns use the gateway's request model IDs, including
`claude-haiku-4-5-20251001` for Haiku. `config/events.json`'s `scheduleModel`
uses Macro's separate provider/model namespace: `anthropic/claude-haiku-4-5`.

```ts
// Replace semantic relevance for ordinary messages; protected messages still wake.
async relevance(candidate, services) {
  if (candidate.message.text.includes('release rollback'))
    return { relevant: true, reason: 'decided', probabilities: {} };
  return judge(candidate, services); // Import judge from @macro-inc/brain.
}
```

```ts
// Rewrite any part of a turn before concurrency and budget admission.
beforeTurn(turn) {
  return { ...turn, prompt: `${turn.prompt}\nBe concrete.`,
    model: 'claude-haiku-4-5-20251001', maxBudgetUsd: 0.25 };
}
```

```ts
// Observe the actual turn and its final outcome (including cost).
async afterTurn(turn, outcome) {
  if (outcome.status === 'error') await myFailureLog(turn.id);
}
```

```ts
// A custom tier can be defined entirely in brain.ts.
tiers: { review: { concurrency: 1, perRunUsd: 0.5, speaking: true } },
route(item) { return item.kind === 'respond' ? 'review' : item.kind; }
```

```ts
// TypeScript handlers execute in process, exposed to Claude through MCP.
// Import tool and z from @macro-inc/brain. Handler arguments are inferred.
tools: [tool('release_status', 'Read release status', { tag: z.string() },
  async ({ tag }) => ({ content: [{ type: 'text', text: await status(tag) }] }))],
// beforeTurn may replace turn.tools to expose a different set per turn.
```

```ts
// A declared schedule is registered once; a changed trigger replaces it.
schedules: [{ note: 'release sweep', trigger: {
  type: 'cron', schedule: '0 0 9 * * 1', timezone: 'UTC',
} }],
async onSchedule(wake, brain) {
  await brain.remember('sweeps', wake.sessionName);
  // Void/true handles this in code. Return false for a default heartbeat turn.
}
```

```ts
// Middleware wraps both post and reply, in array order; next may transform.
outbound: [async (message, next) => {
  if (message.root !== null && new Date().getUTCHours() < 8)
    return { suppressed: true, reason: 'quiet hours' };
  return next({ ...message, text: message.text.trim() });
}],
```

```ts
// Runtime call transports dispatch brain.onCall(call). A custom hook replaces
// the default join policy; join explicitly for incoming calls.
async onCall(call, brain) {
  if (call.phase === 'ended') await brain.remember('calls', call.id);
}
```

`BrainCall` has `id`, `phase: incoming | connected | ended`, and opaque `metadata`.
`RouteItem` is a discriminated union: respond has lane/batch, heartbeat has reason,
and work has task/conversation/description. `TurnRequest` has optional
`maxBudgetUsd`, in-process `tools`, and Claude `builtinTools` (`[]` disables built-ins), and `strictMcpConfig` (ignores on-disk MCP servers); `afterTurn` receives the admitted `Turn`.
Suppressed posts return `{ suppressed: true, reason }` and do not update last-said
memory. Middleware that calls `next` records the actual transformed text.

See [the complete release-manager composition](examples/release-manager.ts) for
a checked example combining subscriptions, relevance, tools, tiers and schedules.

The runtime contract is `prepare(signal)`, `run(signal)`, `health()` and
`post(turn, channel, text)` and `checkFixture(fixture)`. `prepare` connects and buffers events without
mutating workspace queues. The supervisor starts replacement intake alongside
the old process, then stops old intake and drains its turns before activating
replacement queue processing. Receipt IDs persist across the handoff to avoid
duplicate delivery. Every activation independently verifies a fake DM answer,
the health shape, and draining an admitted turn on abort; workspace tests cannot
replace these conformance checks.

## Voice calls

The Node 24 runner installs the `calls` transport by default. `Brain.onCall`
receives `{ id, phase, metadata }`; without a hook, an incoming call joins and
speaks. A hook replaces that default and can call `brain.joinCall` explicitly:

```ts
async onCall(call, brain) {
  if (call.phase !== 'incoming') return;
  await brain.joinCall(call, {
    answer: (_who, text) => !text.startsWith('Private aside:'),
    allowHandOff: true,
  });
}
```

`CallPolicy.voice` can select another provider model when the creator requests
it; otherwise calls read the server-committed `config/voice.json`. Preserve the
user's voice choice. `config/calls.json` holds channel opt-ins, excluded channels,
and call IDs to skip. Rings, live DMs and invited meetings also qualify. Customer
channel exclusions always win; a hung-up call stays excluded after restart.

Call sessions read the same OPERATING.md and memory as message turns. The
`hand_off` tool schedules the normal work tier, which continues after hang-up.
A call summary is remembered and posted to its conversation; standalone meetings
use a DM with their host. LiveKit uses `@livekit/rtc-node` directly on Node 24.
Nova-3 STT and Aura-2 TTS use pinned LiveKit Inference primitives through the
Macro computer gateway and team credits; project secrets and upstream JWTs
never enter the agent's process. Local turn-taking remains in `calls`; Inference
does not own the conversation. Rescue finalizes a fresh unresolved-span stream
instead of batch recognition. Barge-in clears playback and closes that turn's
TTS sockets instead of sending a provider Clear command. The package README
records the supported endpointing/keyterm options and capability differences. `calls` exports the media, turn-taking, discovery,
replay and transport modules for custom compositions and injected tests.

Private `log/calls/<opaque-call-id>/` diagnostics include events.jsonl and WAVs.
They expire after seven days and only fifty call directories are retained. Calls
have a one-hour recording limit. Do not commit or upload these diagnostics;
telemetry carries only IDs, event categories, counts and timing.

## How I get better at knowing what's for me

Day one is explicit: `config/events.json` has `events: ["*"]` and
`config/jev.json` is `{ "mode": "all" }`, with no questions or threshold.
The stream wildcard remains scoped to my account's entity/workspace access.
My composition can narrow subscriptions after evidence; it cannot unsubscribe
from the message and routine events the library requires.

`log/decisions.jsonl` records event decisions, wakes, cheap triage, turn outcomes,
posted/reacted/ignored signals, negative instructions such as "stop" or "not
you", and creator feedback. Message context stays in workspace history/cache
and fixture files, never telemetry. Because the broker has no reaction fact,
heartbeats poll reactions on my own messages; future reaction events use the
same feedback path. `brain react <channel> <message> <emoji>` records my own
reaction as an outcome too.

The template declares a daily `tune` schedule (04:00 UTC). Its `onSchedule`
handler calls `brain.tune()` in code, and every 100 real wakes triggers the same
maintenance task. This creates a normal work-tier branch/worktree and asks me
to review evidence, change one small part of the filter, run `brain check`,
commit, then merge to main. With insufficient evidence I make no filter change.

```ts
// First deterministic rules belong in brain/triage.ts.
triage(candidate) {
  if (candidate.message.text.includes('release rollback')) return true;
  return undefined; // Delegate other cases to Jev.
},
learning: { wakesPerTune: 100, triageModel: 'claude-haiku-4-5-20251001' },
```

Creator messages, DMs and mentions override a false filter decision. Protected
examples and successful actions accumulate as `MustWakeFixture` JSON in
`brain/fixtures/`. A creator's "you missed this" reply protects the referenced
message. An independent cache registry retains the growing union, even if a
proposed commit removes a fixture. `brain check` replays the composition's
`checkFixture` using the same `evaluate` filter as intake and recorded Jev
probabilities; changing question names requires deterministic rules that still
admit those examples. It refuses a dropped must-wake example or removed useful
event subscription. Full replacement runtimes must implement this contract.

Ordinary events are batched per conversation, then pass through a quiet,
Haiku triage tier (no tools, $0.05 per run) before a full turn. DMs, mentions and
creator messages and retained useful/missed fixture IDs bypass that cheap rejection gate. Tier reservations and the
persisted daily cap apply across triage, respond, heartbeat and work.
`/health.filterSize` counts configured subscriptions plus Jev questions;
`/health.wakeRate` is real wakes divided by decisions. Telemetry reports these
counts/rates without message text.

Filtering configuration and TypeScript composition are frozen to the checked
main snapshot. New commits to `brain.ts`, `brain/**/*.ts`, `brain.lock`, or the
three config JSON files use the same check/health/revert path. Fixture-only,
style, prompt and memory commits do not reload code; style and persona text
remain fresh each turn. A library upgrade is an exact installed `brain.lock`
bump with the same checks and recovery.
