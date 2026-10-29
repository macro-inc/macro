# Type Alias: NotionPlanItem

> **NotionPlanItem** = \{ `alreadyImported?`: `null` \| [`NotionAlreadyImported`](NotionAlreadyImported.md); `decision?`: `null` \| [`NotionDecision`](NotionDecision.md); `path?`: `string`[]; `reason?`: `string` \| `null`; `rows?`: `number` \| `null`; `sampleTitles?`: `string`[]; `shareable?`: `boolean`; `shared?`: `boolean`; `sharedReason?`: `string` \| `null`; `taskFields?`: `null` \| [`NotionTaskFields`](NotionTaskFields.md); \}

One object's place in a workspace import plan.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-alreadyimported"></a> `alreadyImported?` | `null` \| [`NotionAlreadyImported`](NotionAlreadyImported.md) | - |
| <a id="property-decision"></a> `decision?` | `null` \| [`NotionDecision`](NotionDecision.md) | - |
| <a id="property-path"></a> `path?` | `string`[] | Titles of the pages above it, outermost first. |
| <a id="property-reason"></a> `reason?` | `string` \| `null` | Why, in a short sentence, when the decision model gave one. |
| <a id="property-rows"></a> `rows?` | `number` \| `null` | For a data source: rows counted while planning. |
| <a id="property-sampletitles"></a> `sampleTitles?` | `string`[] | For a data source: the titles of a few of its rows. |
| <a id="property-shareable"></a> `shareable?` | `boolean` | Whether the user may change `shared`: false for users without a team. |
| <a id="property-shared"></a> `shared?` | `boolean` | Whether what it becomes is shared with the user's team. |
| <a id="property-sharedreason"></a> `sharedReason?` | `string` \| `null` | Why it is (or is not) shared, when the decision model chose or the import could not share it. |
| <a id="property-taskfields"></a> `taskFields?` | `null` \| [`NotionTaskFields`](NotionTaskFields.md) | - |
