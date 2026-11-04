# Type Alias: ImportDraft

> **ImportDraft** = \{ `excluded?`: `string`[]; `personal?`: `string`[]; `shared?`: `string`[]; `source`: [`ImportReviewSource`](ImportReviewSource.md); \}

The one draft an import review carries: which source's staged plan it
 presents, the plan rows the user took out of it, and the rows whose
 sharing they changed: `shared` to share with their team, `personal` to
 keep to themselves.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-excluded"></a> `excluded?` | `string`[] | Plan rows left out of the import. |
| <a id="property-personal"></a> `personal?` | `string`[] | Plan rows kept private although the plan shares them. |
| <a id="property-shared"></a> `shared?` | `string`[] | Plan rows shared with the team although the plan keeps them private. |
| <a id="property-source"></a> `source` | [`ImportReviewSource`](ImportReviewSource.md) | The staged plan's source; fixed once the review is presented. |
