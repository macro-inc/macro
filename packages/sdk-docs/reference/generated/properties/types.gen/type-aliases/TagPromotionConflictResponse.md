# Type Alias: TagPromotionConflictResponse

> **TagPromotionConflictResponse** = \{ `conflicting_option`: [`PropertyOptionResponse`](PropertyOptionResponse.md); `message`: `string`; \}

Body returned when a promotion collides with a label the team already has.
The caller confirms with the user, then calls the merge endpoint with
`conflicting_option.id` as the target.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-conflicting_option"></a> `conflicting_option` | [`PropertyOptionResponse`](PropertyOptionResponse.md) | The team label that already uses this name. |
| <a id="property-message"></a> `message` | `string` | Human-readable description of the collision. |
