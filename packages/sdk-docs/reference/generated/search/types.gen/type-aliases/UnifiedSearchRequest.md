# Type Alias: UnifiedSearchRequest

> **UnifiedSearchRequest** = \{ `collapse?`: `boolean` \| `null`; `filters?`: [`EntityFilters`](EntityFilters.md); `include_crm?`: `boolean`; `match_type`: [`MatchType`](MatchType.md); `query`: `string`; `search_on?`: [`SearchOn`](SearchOn.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-collapse"></a> `collapse?` | `boolean` \| `null` | - |
| <a id="property-filters"></a> `filters?` | [`EntityFilters`](EntityFilters.md) | Entity filters in the same shape as soup. Entity types with a NIL UUID in their primary ID field are excluded from search. |
| <a id="property-include_crm"></a> `include_crm?` | `boolean` | Opt in to searching the caller's team CRM companies (name/domain). Off by default: CRM results are only included when this is true and the caller has a qualifying team membership. CRM has no content index, so it is searched only under Name / NameContent. |
| <a id="property-match_type"></a> `match_type` | [`MatchType`](MatchType.md) | How to match the search terms. 'exact' for precise case-sensitive phrase matches, 'partial' for prefix/partial matches. REQUIRED field. |
| <a id="property-query"></a> `query` | `string` | The search query string. Must be at least 3 characters. |
| <a id="property-search_on"></a> `search_on?` | [`SearchOn`](SearchOn.md) | Fields to search on (Name, Content, NameContent). Defaults to Content |
