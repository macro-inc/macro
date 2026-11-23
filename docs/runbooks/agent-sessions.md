# Agent session alerts

Runbook for the monitor in
[`monitors/agent-sessions.ts`](../../infra/stacks/monitoring/monitors/agent-sessions.ts)
and the Agent sessions dashboard it graphs on. Span fields are described in
[`crates/agent_session/README.md`](../../crates/agent_session/README.md).

## Tool failures

More than a fifth of agent session tool calls failed in the last hour. One
span per call counts: the agent loop's `execute_tool` span, or the ACP
harness's for an external runtime, both carrying `gen_ai.conversation.id`.

1. **Which tools.** The "Tool failure rate by tool" widget. One tool far above
   the rest is the usual shape; every tool at once points at the harness or a
   service they all call.
2. **The errors.** Search `service:agent-harness-service
   @gen_ai.operation.name:execute_tool @gen_ai.tool.name:<tool> status:error`
   and read `error.message`. A tool reached through MCP has a second
   `execute_tool` span inside it with the downstream error.
3. **Recent deploys.** Compare against the latest `agent-harness-service`
   deploy and the service the tool calls.
4. **One session.** Take a failing span's `gen_ai.conversation.id` (the agent
   session id) to the `agent-session-analysis` skill to see what the model did
   around the failure.

`ExecuteCode` programs that fail are results, not errors, so they show in the
"Code-mode failure rate" widget, not here.
