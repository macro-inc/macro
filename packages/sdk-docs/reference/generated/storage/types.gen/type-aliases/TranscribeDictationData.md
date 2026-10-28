# Type Alias: TranscribeDictationData

> **TranscribeDictationData** = \{ `body`: `Blob` \| `File`; `path?`: `never`; `query?`: \{ `language?`: `string`; \}; `url`: `"/dictation/transcribe"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | `Blob` \| `File` | OpenAPI representation of the raw encoded audio body extracted as `Bytes`. |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `language?`: `string`; \} | - |
| `query.language?` | `string` | ISO 639-1 language hint |
| <a id="property-url"></a> `url` | `"/dictation/transcribe"` | - |
