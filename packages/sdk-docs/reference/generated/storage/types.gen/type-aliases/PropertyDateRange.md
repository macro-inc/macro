# Type Alias: PropertyDateRange

> **PropertyDateRange** = \{ `end?`: `string` \| `null`; `key`: `string`; `start?`: `string` \| `null`; \}

A half-open UTC interval. An absent start or end extends to infinity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-end"></a> `end?` | `string` \| `null` | Exclusive end, or positive infinity. |
| <a id="property-key"></a> `key` | `string` | Unique caller-supplied group key. |
| <a id="property-start"></a> `start?` | `string` \| `null` | Inclusive start, or negative infinity. |
