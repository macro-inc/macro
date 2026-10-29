# Type Alias: DateRange

> **DateRange** = \{ `end`: `string`; `start`: `string`; \}

A span of time from `start` to `end`, both included. A write whose end
comes before its start is refused.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-end"></a> `end` | `string` | Where it ends; never before the start. |
| <a id="property-start"></a> `start` | `string` | Where it starts. |
