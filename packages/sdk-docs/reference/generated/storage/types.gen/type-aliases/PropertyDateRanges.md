# Type Alias: PropertyDateRanges

> **PropertyDateRanges** = \{ `missing_value_bucket_key`: `string`; `ranges`: [`PropertyDateRange`](PropertyDateRange.md)[]; \}

A complete partition of present dates plus one bucket for absent values.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-missing_value_bucket_key"></a> `missing_value_bucket_key` | `string` | Caller-supplied group key for entities with no date value. |
| <a id="property-ranges"></a> `ranges` | [`PropertyDateRange`](PropertyDateRange.md)[] | Ordered, contiguous ranges covering every present date. |
