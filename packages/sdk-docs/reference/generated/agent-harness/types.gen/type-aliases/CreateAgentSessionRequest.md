# Type Alias: CreateAgentSessionRequest

> **CreateAgentSessionRequest** = \{ `botId?`: `string` \| `null`; `id?`: `string` \| `null`; `instructions?`: `string` \| `null`; `model?`: `string` \| `null`; `owner?`: `string` \| `null`; `prompt?`: `string` \| `null`; `repoBranch?`: `string` \| `null`; `repoUrl?`: `string` \| `null`; `thread?`: `null` \| [`CreateSessionThread`](CreateSessionThread.md); `workspace?`: `string` \| `null`; \}

Request body for `POST /agent-sessions`.

Carries two shapes, told apart by `workspace`. Naming one asks for an
external session: the runtime is the bot operator's, so the caller has to
say which bot and which directory, and must own that bot. Omitting it asks
for a managed session, whose runtime this deployment provisions. A managed
request may select an authorized persisted persona with `botId`; omitting
it uses the deployment's default coding persona. Fields describing someone
else's runtime must still be omitted rather than quietly ignored. Mixing
the two shapes is refused rather than guessed at.

Clients serialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-botid"></a> `botId?` | `string` \| `null` | Bot the session runs for. On a managed request this optionally selects a persisted persona the user owns, may use through team membership, or can `@` mention in a shared channel; omitting it uses the deployment's default coding persona. On an external request, bot callers may omit it (their own identity is used) and must not name another bot; user callers must supply a bot they own. |
| <a id="property-id"></a> `id?` | `string` \| `null` | Id to create the session under, minted by the caller. Lets a surface open on the session's final id - URL, history row, references - the moment the user acts, rather than after this request answers (which for a managed sandbox can take a while). Omitted, the service mints one. Answers 409 if a session already holds the id. On an external request it is how a runtime answering a composer request names the id it was handed, so the requester waiting on that id finds the session. |
| <a id="property-instructions"></a> `instructions?` | `string` \| `null` | Instructions the session's runtime works under, for its whole life. Recorded on the session whichever runtime serves it. Only the in-process one acts on them today; `agent_harness`'s `AgentKind` records what each of the others will need to. |
| <a id="property-model"></a> `model?` | `string` \| `null` | Model the managed session runs on, overriding the persona's. Managed sessions only: an external runtime picks its own. The session's model from the moment it exists, which is what a caller choosing one before the first prompt means. Selecting a model *during* a session is a control action instead, and reads as one in its transcript. |
| <a id="property-owner"></a> `owner?` | `string` \| `null` | The user who owns the session. Ignored for user callers, who always own their own sessions, for harness callers, whose verified acting user owns the session, and for bots that already act for a verified user. A bot without one may name a user here. That claim is trusted for the bot's own sessions. With no claim, a team bot owns the session itself only while non-user owners are enabled. Every other bot still needs an owner. |
| <a id="property-prompt"></a> `prompt?` | `string` \| `null` | First prompt to deliver once the session is running. Managed sessions only - an external runtime sends its own first prompt through the control endpoint. Omitted, the session opens idle. |
| <a id="property-repobranch"></a> `repoBranch?` | `string` \| `null` | Starting branch for a managed coding session's selected repository. Omitted, the session starts on the repository's default branch. |
| <a id="property-repourl"></a> `repoUrl?` | `string` \| `null` | Explicit GitHub repository for a managed Cursor session, as one of the urls `GET /agent-repositories` lists for the caller. Access is checked for the session owner. For external sessions this is informational: cloning it is the runtime operator's job. |
| <a id="property-thread"></a> `thread?` | `null` \| [`CreateSessionThread`](CreateSessionThread.md) | - |
| <a id="property-workspace"></a> `workspace?` | `string` \| `null` | Absolute directory the bot's harness runs in on its runtime. Present for an external session, absent for a managed one, which runs in the path baked into its image. |
