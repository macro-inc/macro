# Type Alias: CreateManagedSessionOptions

> **CreateManagedSessionOptions** = \{ `agent?`: [`Agent`](../../../agents/agent/classes/Agent.md); `instructions?`: `string`; `model?`: `string`; `prompt?`: `string`; `repoBranch?`: `string`; `repoUrl?`: `string`; \}

What a managed session is created with.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agent"></a> `agent?` | [`Agent`](../../../agents/agent/classes/Agent.md) | Persona the session runs as, from AgentNamespace.list or [Agent.byId](../../../agents/agent/classes/Agent.md#byid). The caller must be able to use it. Omitted, the deployment's default coding persona, or Cursor when `repoUrl` is set. Its harness, instructions and model apply unless `instructions` or `model` override them. |
| <a id="property-instructions"></a> `instructions?` | `string` | Instructions the session's runtime works under, fixed for its life. Outranks the persona's when both are set. |
| <a id="property-model"></a> `model?` | `string` | The model the session runs on, instead of its persona's. The session's model from creation, read back as [AgentSession.model](../classes/AgentSession.md#property-model). |
| <a id="property-prompt"></a> `prompt?` | `string` | First prompt to deliver once the session is running. |
| <a id="property-repobranch"></a> `repoBranch?` | `string` | The branch the session starts on; needs `repoUrl`. Omitted, the repository's default branch. |
| <a id="property-repourl"></a> `repoUrl?` | `string` | The repository the session works on, as one of the URLs [AgentSession.repositories](../classes/AgentSession.md#repositories) lists for the caller. Omitted, the runtime chooses from the prompt. Honored for Cursor sessions; omit `agent` and the session starts as Cursor. |
