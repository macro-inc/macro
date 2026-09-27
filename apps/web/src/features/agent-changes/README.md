# Pull request diff viewer

`agent-changes.tsx` wires the viewer into agent sessions. The controller and views
can also be mounted by a PR external entity without an `AgentSessionProvider`.

A host supplies `ChangesSource` and `ChangesHost` from
`context/agent-changes-context.ts`, creates a controller with `createAgentChanges`,
and mounts `AgentChangesControllerProvider` around `ChangesPane` or
`AgentChangesSplit`. Give each host a stable `scopeKey` (for example,
`pr:<foreign-entity-id>`) to isolate its locally persisted collapse state and notes.
The optional `agent` capability enables inline note creation and sending; omit it
for a read-only PR viewer. The optional `canHaveChanges` accessor hides every
control and the pane while false; the session host reports it from the harness so
a chat-only (in-memory) session shows no GitHub chrome. Clipboard, external
navigation, and notifications are host callbacks.

The source owns fetching, cache identity, and conversion into the feature's core
changeset types. The PR page's adapter is `block-pr/data/pr-changes.ts`, over
`GET /github_pull_requests/{id}/changes` and `/changes/patch` in the storage
service; `block-pr/component/PrChanges.tsx` mounts it read-only under
`pr:<foreign-entity-id>` without an agent session.

Layout and diff style are controlled accessor/setter pairs. Hosts using the app
router can use `url-diff-state.ts`; embedded viewers can provide local signals.
The URL codec supports namespaced ids and preserves neighboring viewer entries.
A host drops its own entry, in place, once no mounted host shows its scope.
