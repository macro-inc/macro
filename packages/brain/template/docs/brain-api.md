# My brain library (0.2.0)

`brain.ts` is my composition. `brain.lock` contains exactly `0.2.0`. The runner
maps `@macro-inc/brain` to that version installed in the image, offline. Import
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

The template preserves the default stream → Jev → conversation lane → respond
turn, heartbeat, scheduled wake-up and work handoff behavior. `onEvent` observes
every event before its default handler; `relevance: typeof judge` replaces Jev.
Errors in my handlers fail the process and trigger recovery. Subscriptions alone
do not install handlers. Never record credentials or private message bodies in logs.

The public module exports these typed primitives:

| API | Contract |
| --- | --- |
| `Composition` | `(deps: BrainDeps) => BrainRuntime \| Promise<BrainRuntime>`. Default export. |
| `BrainRuntime` | `run(signal: AbortSignal): Promise<void>`. Abort stops intake, drains turns, closes resources. |
| `Brain(deps, wiring?)` | Default composition. `Wiring` has `subscriptions`, `onEvent`, `relevance`. Public control methods include `post`, `reply`, `handoff`, `remember`, `schedule`, `health`. |
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
no real API credentials or model calls reach checks.

Direct Deno permissions allow filesystem access only in my workspace and `/tmp`,
network access only to the configured gateway, Anthropic proxy and local control
port, and subprocesses only `git` and `claude`. Environment is explicitly selected;
no ambient service secrets are inherited. Deno permissions do not restrict what
an allowed executable itself can do: the persona's systemd unit and OS identity
remain the outer boundary. Do not treat this as isolation from malicious code.

## Composition hooks

All hooks are optional. Their return values may be promises. Hooks run inside
my sandbox and errors fail the affected operation. Turn hooks apply to respond,
heartbeat and work. Budgets remain bounded by the tier's cap and the daily cap.

```ts
// Rewrite any part of a turn before concurrency and budget admission.
beforeTurn(turn) {
  return { ...turn, prompt: `${turn.prompt}\nBe concrete.`,
    model: 'claude-haiku-4-5', maxBudgetUsd: 0.25 };
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
  if (new Date().getUTCHours() < 8)
    return { suppressed: true, reason: 'quiet hours' };
  return next({ ...message, text: message.text.trim() });
}],
```

```ts
// Transport adapters dispatch brain.onCall(call). No call transport is installed
// by this hook; the calls integration provides it separately.
async onCall(call, brain) {
  if (call.phase === 'ended') await brain.remember('calls', call.id);
}
```

`BrainCall` has `id`, `phase: incoming | connected | ended`, and opaque `metadata`.
`RouteItem` is a discriminated union: respond has lane/batch, heartbeat has reason,
and work has task/conversation/description. `TurnRequest` has optional
`maxBudgetUsd` and in-process `tools`; `afterTurn` receives the admitted `Turn`.
Suppressed posts return `{ suppressed: true, reason }` and do not update last-said
memory. Middleware that calls `next` records the actual transformed text.
