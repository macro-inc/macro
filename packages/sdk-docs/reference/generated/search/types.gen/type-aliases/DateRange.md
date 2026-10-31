# Type Alias: DateRange

> **DateRange** = \{ `end`: `string`; `start`: `string`; \}

A span of time from `start` to `end`, both included. The end is never
before the start: a range that would end earlier does not deserialize.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-end"></a> `end` | `string` |
| <a id="property-start"></a> `start` | `string` |
