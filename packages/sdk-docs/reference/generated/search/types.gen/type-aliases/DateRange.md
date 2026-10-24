# Type Alias: DateRange

> **DateRange** = \{ `end?`: `string` \| `null`; `start?`: `string` \| `null`; \}

UTC timestamp interval. Lower bounds are inclusive; upper bounds are exclusive.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-end"></a> `end?` | `string` \| `null` | Exclusive UTC upper bound, omitted for an open end. |
| <a id="property-start"></a> `start?` | `string` \| `null` | Inclusive UTC lower bound, omitted for an open start. |
