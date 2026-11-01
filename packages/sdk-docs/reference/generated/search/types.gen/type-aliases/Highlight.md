# Type Alias: Highlight

> **Highlight** = \{ `content?`: `string`[]; `name?`: `string` \| `null`; \}

The search service version of a highlight

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-content"></a> `content?` | `string`[] | If the match was on the entity content, this will provide a list of highlights for each content match |
| <a id="property-name"></a> `name?` | `string` \| `null` | If the match was on the entity name, this will be present with that highlight |
