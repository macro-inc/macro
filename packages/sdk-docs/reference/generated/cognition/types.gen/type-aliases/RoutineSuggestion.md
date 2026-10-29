# Type Alias: RoutineSuggestion

> **RoutineSuggestion** = \{ `affectsOthers`: `boolean`; `icon`: [`SuggestionIcon`](SuggestionIcon.md); `instructions`: `string`; `keepProbability`: `number`; `notify`: `boolean`; `reason`: `string`; `summary`: `string`; `surface`: [`RoutineSurface`](RoutineSurface.md); `title`: `string`; `trigger`: [`SuggestionTrigger`](SuggestionTrigger.md); \}

One routine the AI suggests for a user, ready to enable as-is.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-affectsothers"></a> `affectsOthers` | `boolean` | Sends, posts, shares, or changes what other people see. |
| <a id="property-icon"></a> `icon` | [`SuggestionIcon`](SuggestionIcon.md) | The glyph to show. |
| <a id="property-instructions"></a> `instructions` | `string` | What the routine agent follows on every run. |
| <a id="property-keepprobability"></a> `keepProbability` | `number` | The model's estimate, 0-1, that the user keeps it once enabled for them unasked. |
| <a id="property-notify"></a> `notify` | `boolean` | Whether every run should show in the user's Home. |
| <a id="property-reason"></a> `reason` | `string` | Why it fits this user. |
| <a id="property-summary"></a> `summary` | `string` | One sentence on what it does. |
| <a id="property-surface"></a> `surface` | [`RoutineSurface`](RoutineSurface.md) | The sidebar it belongs to. |
| <a id="property-title"></a> `title` | `string` | Short imperative routine name. |
| <a id="property-trigger"></a> `trigger` | [`SuggestionTrigger`](SuggestionTrigger.md) | When it runs. |
