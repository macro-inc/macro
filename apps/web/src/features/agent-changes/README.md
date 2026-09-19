# Pull request diff viewer

`agent-changes.tsx` wires the viewer into agent sessions. The controller and views
can also be mounted by a PR external entity without an `AgentSessionProvider`.

A host supplies `ChangesSource` and `ChangesHost` from
`context/agent-changes-context.ts`, creates a controller with `createAgentChanges`,
and mounts `AgentChangesControllerProvider` around `ChangesPane` or
`AgentChangesSplit`. Give each host a stable `scopeKey` (for example,
`pr:<foreign-entity-id>`) to isolate its locally persisted collapse state and notes.
The optional `agent` capability enables inline note creation and sending; omit it
for a read-only PR viewer. Clipboard, external navigation, and notifications are
host callbacks.

The source owns fetching, cache identity, and conversion into the feature's core
changeset types. A PR entity adapter should resolve its GitHub owner/repository/PR
number and implement this same contract using shared queries. It does not need to
construct an agent session. That adapter and its backend endpoint are not yet wired.

Layout and diff style are controlled accessor/setter pairs. Hosts using the app
router can use `url-diff-state.ts`; embedded viewers can provide local signals.
The URL codec supports namespaced ids and preserves neighboring viewer entries.
