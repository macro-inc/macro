# Type Alias: UpdateOverageRequest

> **UpdateOverageRequest** = \{ `enabled`: `boolean`; `limitCents?`: `number`; \}

Request body for [`update_overage_handler`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-enabled"></a> `enabled` | `boolean` | Bill usage past allowance and credits. |
| <a id="property-limitcents"></a> `limitCents?` | `number` | Per-period cap on overage spend, cents. Required when enabling. |
