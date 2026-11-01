# Type Alias: ImportCounters

> **ImportCounters** = \{ `duplicates`: `number`; `imported`: `number`; `processed`: `number`; `reactions`: `number`; `skipped`: `number`; \}

Committed counters, never optimistic browser or uncommitted worker counts.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-duplicates"></a> `duplicates` | `number` | Previously committed source identities. |
| <a id="property-imported"></a> `imported` | `number` | Newly persisted messages. |
| <a id="property-processed"></a> `processed` | `number` | Source records examined through the committed checkpoint. |
| <a id="property-reactions"></a> `reactions` | `number` | Newly persisted reactions. |
| <a id="property-skipped"></a> `skipped` | `number` | Unsupported, empty or otherwise deliberately skipped records. |
