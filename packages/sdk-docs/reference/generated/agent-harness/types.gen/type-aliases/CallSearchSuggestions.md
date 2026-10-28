# Type Alias: CallSearchSuggestions

> **CallSearchSuggestions** = \{ `from`: `string`[]; `in`: `string`[]; `query?`: `string` \| `null`; `status?`: `string` \| `null`; \}

Call search supports speakers, channels and attendance status.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-from"></a> `from` | `string`[] | Speaker names or supplied addresses. |
| <a id="property-in"></a> `in` | `string`[] | Channel names. |
| <a id="property-query"></a> `query?` | `string` \| `null` | Remaining keyword phrase. |
| <a id="property-status"></a> `status?` | `string` \| `null` | Attendance display value, resolved against supported options by the client. |
