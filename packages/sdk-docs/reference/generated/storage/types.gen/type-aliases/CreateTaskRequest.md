# Type Alias: CreateTaskRequest

> **CreateTaskRequest** = \{ `markdown?`: `string` \| `null`; `projectId?`: `string` \| `null`; `propertyValues?`: [`PropertyInput`](PropertyInput.md)[] \| `null`; `shareWithTeam?`: `boolean`; `taskName`: `string`; `teamId?`: `string` \| `null`; \}

Request body for creating a task.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-markdown"></a> `markdown?` | `string` \| `null` | Markdown source text. Defaults to an empty task document. |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | Optional project ID to associate the task with. |
| <a id="property-propertyvalues"></a> `propertyValues?` | [`PropertyInput`](PropertyInput.md)[] \| `null` | Optional property values to set on the task. |
| <a id="property-sharewithteam"></a> `shareWithTeam?` | `boolean` | Whether to share the task with your team or not Defaults to true |
| <a id="property-taskname"></a> `taskName` | `string` | The name of the task. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | Team to assign the task number within. If omitted, it is inferred only when the creator belongs to exactly one team. |
