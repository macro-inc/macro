# Type Alias: RoutineEventFilter

> **RoutineEventFilter** = `Omit`\<[`EventFilter`](../../../../../generated/scheduled-action/types.gen/type-aliases/EventFilter.md), `"ids"` \| `"condition"`\> & \{ `condition?`: `string`; `entities?`: [`EntityReference`](../../../reference/type-aliases/EntityReference.md)[]; \}

An event selector references resources by typed handles.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `condition?` | `string` | Optional yes/no condition on the triggering content. |
| `entities?` | [`EntityReference`](../../../reference/type-aliases/EntityReference.md)[] | Resource selectors for these events. Omit to match all resources. |
