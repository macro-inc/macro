# Type Alias: RunImportOutcome

> **RunImportOutcome** = \{ `discarded`: `number`; `importing`: `number`; \}

Outcome of accepting/declining staged rows via `POST /import/run`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-discarded"></a> `discarded` | `number` | How many rows were discarded. |
| <a id="property-importing"></a> `importing` | `number` | How many rows flipped to `importing` (jobs are now copying them in). |
