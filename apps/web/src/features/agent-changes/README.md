# Pull request diff viewer

`agent-changes.tsx` wires the viewer into agent sessions. The controller and views
are also mounted by `block-pr/pr-changes.tsx` without an `AgentSessionProvider`.

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
changeset types. `queries/pull-request-changes.ts` reads a standalone PR snapshot
through the authenticated agent-harness `/pull-requests/changes` endpoint, which
uses the viewer's repository access and the shared GitHub diff reader and budgets.
It does not construct an agent session.

Session hosts supply `openPullRequest` to navigate to the PR entity's Overview or
Diff tab. While a PR is linked, the embedded pane stays hidden and does not fetch
its patch, even if the URL still contains an old pane layout. `open-pull-request.ts`
resolves the synced foreign entity and uses normal responsive split navigation,
including selecting the requested tab when an existing PR split is reused.

Layout and diff style are controlled accessor/setter pairs. Hosts using the app
router can use `url-diff-state.ts`; embedded viewers can provide local signals.
The URL codec supports namespaced ids and preserves neighboring viewer entries.
