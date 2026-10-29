# Type Alias: RoutineSuggestionSet

> **RoutineSuggestionSet** = \{ `generatedAt?`: `string` \| `null`; `status`: [`SuggestionSetStatus`](SuggestionSetStatus.md); `suggestions`: [`RoutineSuggestion`](RoutineSuggestion.md)[]; \}

A user's routine suggestions.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-generatedat"></a> `generatedAt?` | `string` \| `null` | When `suggestions` were generated; absent before the first one lands. |
| <a id="property-status"></a> `status` | [`SuggestionSetStatus`](SuggestionSetStatus.md) | Where generation stands. |
| <a id="property-suggestions"></a> `suggestions` | [`RoutineSuggestion`](RoutineSuggestion.md)[] | The latest generated suggestions, best first within each surface. |
