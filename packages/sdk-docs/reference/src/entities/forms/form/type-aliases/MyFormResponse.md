# Type Alias: MyFormResponse

> **MyFormResponse** = \{ `answers`: [`FormAnswer`](FormAnswer.md)[]; `booking?`: [`FormBookingStep`](FormBookingStep.md); `response`: [`FormResponse`](../../response/classes/FormResponse.md); `row?`: [`DatabaseRow`](../../../databases/row/classes/DatabaseRow.md); `status`: [`ResponseStatus`](../../../../../generated/storage/types.gen/type-aliases/ResponseStatus.md); `stoppedAtSection?`: [`FormSection`](../../section/classes/FormSection.md); `submittedAt`: `string`; `updatedAt`: `string`; \}

The caller's receipt and current answers, read without access to other responses.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-answers"></a> `answers` | [`FormAnswer`](FormAnswer.md)[] |
| <a id="property-booking"></a> `booking?` | [`FormBookingStep`](FormBookingStep.md) |
| <a id="property-response"></a> `response` | [`FormResponse`](../../response/classes/FormResponse.md) |
| <a id="property-row"></a> `row?` | [`DatabaseRow`](../../../databases/row/classes/DatabaseRow.md) |
| <a id="property-status"></a> `status` | [`ResponseStatus`](../../../../../generated/storage/types.gen/type-aliases/ResponseStatus.md) |
| <a id="property-stoppedatsection"></a> `stoppedAtSection?` | [`FormSection`](../../section/classes/FormSection.md) |
| <a id="property-submittedat"></a> `submittedAt` | `string` |
| <a id="property-updatedat"></a> `updatedAt` | `string` |
