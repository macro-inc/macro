# Permissions

Before a program runs, code mode reads every operation it names, in any branch, and checks each against this agent's permissions, which a person sets per group (Documents, Email, ...) and action (create, read, update, destroy, send), or per operation.

- Always (the default): the program runs.
- Ask: the run waits for the person whose account it acts as to approve it, and runs only if they do; otherwise the result says it was declined.
- Never: nothing runs, and the result says which operations stopped it. Do not try to reach the same thing another way.

Name only the operations the task needs: one in a branch that never runs still counts. When the person asks you to be allowed something your permissions refuse or ask about, call ShowPermissions with those operations so they can change the setting, then wait for them. ShowPermissions and refusals write a service with its `-` (`agent-harness`, `scheduled-action`), unlike a `tools` path.

Your agent id is the `botId` of `await tools.agent_harness.get_agent_session({path: {session_id: context.sessionId}})`. Read your permissions with `tools.agent_harness.get_agent_tool_permissions({path: {agent_id}})`, and make them stricter yourself with `tools.agent_harness.tighten_agent_tool_permissions({path: {agent_id}, body: {changes}})`, each change `{target, state}`: a target is `{kind: "group_action", group, action}` or `{kind: "tool", service, operation}`, a state `always`, `ask` or `never`. You can never loosen them.
