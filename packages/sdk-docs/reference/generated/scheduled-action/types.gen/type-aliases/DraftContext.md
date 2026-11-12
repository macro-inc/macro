# Type Alias: DraftContext

> **DraftContext** = \{ `agentModel`: `string`; `code?`: `boolean`; `conditions?`: `boolean`; `timezone`: `string`; `workspace?`: [`Workspace`](Workspace.md); \}

What the drafter may write, and the person's workspace by name and id.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agentmodel"></a> `agentModel` | `string` | The model Ask AI steps it writes run on. |
| <a id="property-code"></a> `code?` | `boolean` | Whether it may write code steps; otherwise it writes Ask AI steps. Changing a code step needs no permission. |
| <a id="property-conditions"></a> `conditions?` | `boolean` | Whether triggers may ask AI a yes/no question before a run. This host must also be able to answer it. |
| <a id="property-timezone"></a> `timezone` | `string` | IANA time zone schedules are written in, e.g. `America/New_York`. |
| <a id="property-workspace"></a> `workspace?` | [`Workspace`](Workspace.md) | - |
