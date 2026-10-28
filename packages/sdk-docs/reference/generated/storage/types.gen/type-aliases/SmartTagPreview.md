# Type Alias: SmartTagPreview

> **SmartTagPreview** = \{ `channels`: [`SmartTagChannelMatch`](SmartTagChannelMatch.md)[]; `totalCount`: `number`; \}

A bounded preview and the total number of visible channels matching a rule.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channels"></a> `channels` | [`SmartTagChannelMatch`](SmartTagChannelMatch.md)[] | First matches, in alphabetical order. |
| <a id="property-totalcount"></a> `totalCount` | `number` | Number of matching channels the caller participates in, including overflow. |
