# Type Alias: FormResponse

> **FormResponse** = \{ `formId`: `string`; `id`: `string`; `row`: `string` \| `null`; `status`: [`ResponseStatus`](ResponseStatus.md); `stoppedAtSection`: `string` \| `null`; `submittedAt`: `string`; `updatedAt`: `string`; \}

One entry of a form's submission ledger: who answered, when, and where
the answers went.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-formid"></a> `formId` | `string` | The form. |
| <a id="property-id"></a> `id` | `string` | The entry. |
| <a id="property-row"></a> `row` | `string` \| `null` | The row holding the answers; `null` when stopped, or once the row was deleted from the table. |
| <a id="property-status"></a> `status` | [`ResponseStatus`](ResponseStatus.md) | Saved, or stopped at a gate. |
| <a id="property-stoppedatsection"></a> `stoppedAtSection` | `string` \| `null` | The gate that stopped it. |
| <a id="property-submittedat"></a> `submittedAt` | `string` | When it was first submitted. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When it last changed. |
