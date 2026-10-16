# Type Alias: ImportLimits

> **ImportLimits** = \{ `conversations`: `number`; `databaseBatchBytes`: `number`; `databaseBatchMessages`: `number`; `jsonBytes`: `number`; `partBytes`: `number`; `partRecords`: `number`; `recordBytes`: `number`; `registrationBatch`: `number`; `selectedBytes`: `number`; `zipEntries`: `number`; \}

Configurable bounds shared with browser staging and enforced again by the worker.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-conversations"></a> `conversations` | `number` | Maximum selected conversations. |
| <a id="property-databasebatchbytes"></a> `databaseBatchBytes` | `number` | Maximum historical batch payload bytes. |
| <a id="property-databasebatchmessages"></a> `databaseBatchMessages` | `number` | Maximum messages in a historical batch. |
| <a id="property-jsonbytes"></a> `jsonBytes` | `number` | Maximum users, root metadata or individual day JSON bytes. |
| <a id="property-partbytes"></a> `partBytes` | `number` | Maximum NDJSON part bytes. |
| <a id="property-partrecords"></a> `partRecords` | `number` | Maximum records per part. |
| <a id="property-recordbytes"></a> `recordBytes` | `number` | Maximum bytes per NDJSON record, including newline. |
| <a id="property-registrationbatch"></a> `registrationBatch` | `number` | Maximum descriptors or completion identities per call. |
| <a id="property-selectedbytes"></a> `selectedBytes` | `number` | Maximum selected temporary data bytes across all uploads. |
| <a id="property-zipentries"></a> `zipEntries` | `number` | Maximum ZIP entries scanned by the browser. |
