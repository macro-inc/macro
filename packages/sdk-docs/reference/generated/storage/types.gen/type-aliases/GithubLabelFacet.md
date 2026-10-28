# Type Alias: GithubLabelFacet

> **GithubLabelFacet** = \{ `color?`: `string` \| `null`; `count`: `number`; `name`: `string`; \}

A label among the visible GitHub pull requests. Labels with the same name in different
repositories count together.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-color"></a> `color?` | `string` \| `null` | The label's most recently synced color, as six hex digits without `#`. |
| <a id="property-count"></a> `count` | `number` | Number of visible pull requests with the label. |
| <a id="property-name"></a> `name` | `string` | The label's name. |
