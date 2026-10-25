# Code mode on the public MCP

Status: implemented behind `ai-code-mode`. The agent guide's "Code mode on the
public MCP" section is the current behaviour; this document keeps the reasoning.

Sources:

- [Code Mode: give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/) (Cloudflare)
- [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp) (Anthropic)

## Goal

Give external MCP clients (Claude, ChatGPT, Cursor) the code mode that agent
sessions already have: write one JavaScript module against the real Macro SDK
instead of chaining many tool calls. Only users with the `ai-code-mode` flag
see it.

## What exists

- `crates/code_execution`: fresh Deno child per run, prebundled SDK, network
  limited to Macro service hosts, 30 s deadline.
- `crates/agent_code_mode`: `ExecuteCode`, `DescribeCodeTools`, execution
  journal, review stacks. Session-bound throughout: `ExecutionIdentity` needs a
  session, turn and agent; the journal is keyed by session; turn Stop cancels;
  owner approval goes through the session's `NativeToolGate`.
- Docs selection (`select_documentation`): once per turn, one Jev `decide` call
  over the last user message, one question per SDK entity (30). Keeps p ≥ 0.5,
  top 4, 48 KiB budget, falls back to an entity's overview when its full
  reference does not fit, 1 s deadline. The result goes into the system prompt.
- Public MCP (`services/agent_harness_service/src/public_mcp`): stateless,
  OAuth user id only, `ai_tools::tools_for(AiHost::Mcp)`.

The MCP has no system prompt and never sees the user's message, so per-turn
docs injection cannot carry over. The agent has to ask for docs itself.

## Design

### 1. Docs for a task

`DescribeCodeTools` gains `task: Option<String>`: a description of what the
agent is about to do. When set, the server runs the same Jev selection over
that text and returns every relevant entity's reference.

Split `select_documentation` into:

- `select_entities(user, text, cognition, cancel) -> Vec<SdkDocumentation>`:
  the Jev call and threshold, no rendering.
- The existing prompt renderer (top 4, 48 KiB, 1 s) for agent sessions.
- A tool renderer: all entities over the threshold, a larger deadline (the
  agent is waiting on this call), and a byte budget sized for MCP tool-result
  limits, falling back to overviews past it. On Jev failure, return the compact
  catalog and say so.

The MCP instructions and the `ExecuteCode` description tell the agent to call
`DescribeCodeTools({task})` before writing code. Nothing enforces it: an
uninformed program fails with an SDK error, and the agent can look up docs
then. Agent sessions get the `task` field too.

### 2. Flagged tool surface

Evaluate `ai-code-mode` for the OAuth user in `initialize`, `list_tools` and `call_tool`,
reusing `agent_inmem::domain::tool_mode::FlaggedToolMode`.

- Off: unchanged.
- On: `tools_for_inner(AiHost::Mcp, true)` (new `ai_tools::tools_for_mcp_code_mode`),
  which already drops SDK-covered tools via `covered_by_code_sdk`, plus
  `ExecuteCode` and `DescribeCodeTools`. `initialize` (which, unlike
  `get_info`, sees the request) appends code-mode instructions.
- `call_tool` rejects `ExecuteCode` / `DescribeCodeTools` for unflagged users.
  Hidden native tools stay callable; they are the same tools.

The public MCP is stateless, so each request loads flags. `PostHogFeatureFlags`
does not cache; add a short per-user TTL cache in front of it rather than a
PostHog call per tool call. Clients cache tool lists, so a flag change shows up
on reconnect.

### 3. User-scoped execution

A user-scoped entry point next to `SessionCodeMode`:

```rust
#[async_trait]
pub trait UserCodeMode: Send + Sync + 'static {
    /// Execute as the authenticated user; no session, journal or reviews.
    async fn execute(
        &self,
        user: &MacroUserIdStr<'static>,
        request: ExecuteRequest,
        cancel: CancellationToken,
    ) -> Result<UserExecutionReceipt, CodeModeError>;
}
```

- **Credentials:** `MacroApiTokenSigner::mint_for(user, 60)`, with no agent
  id, so writes are attributed to the user like every other MCP tool. No
  `NativeToolGate`: the MCP client already asks the user before tool calls.
- **No journal:** the MCP response is the record, and there is no UI to load a
  saved execution into. The MCP `ExecuteCode` therefore drops `execution_id`.
- **No reviews:** there is no session stream to present into. `main` returns
  `{data}`; review references fail the run. `session` / `execution` are undefined
  (the bootstrap already handles absent ids).
- **Cancellation:** the rmcp request token (`context.ct`); no turn watcher.
- **Admission:** a separate `ExecutionService` with its own limits, sharing the
  `DenoRunner`, so MCP traffic cannot starve agent sessions.
- **Tool schema:** a separate `ExecuteCode` struct and description for MCP
  (`source`, `timeout_ms`), sharing the runtime contract text.

Factor the run loop of `CodeModeService::run` (progress, activity, outcome
validation) into a helper both entry points call. The session path keeps its
journal, turn watch and gate.

### 4. Telemetry

Span `code_mode.user_execution` with status, activity count, timeout and source
bytes, never source, results or the user's email-bearing id. Span
`code_mode.task_documentation` with the selected and omitted entities, bytes and
selection status. Trace headers already reach SDK calls.

## Decisions

- **Email send.** Allowed. The SDK's `email.send` works over MCP code mode;
  the MCP client's own approval before each `ExecuteCode` call is the gate, as
  it is for every other MCP write.
- **Tool-result budget.** 32 KiB of references per task response. A first
  local run at 80 KiB produced an 87K-character response that Claude Code moved
  out of context into a file. Entities that do not fit whole fall back to their
  namespace overview, then to `omitted`; the overview was enough to write the
  program in that run.
- **Reviews.** An empty `reviews: []` (which the shared guides use) is dropped;
  any review reference fails the run. The `templates` and `examples` guides,
  which depend on reviews, are unavailable to MCP clients.
