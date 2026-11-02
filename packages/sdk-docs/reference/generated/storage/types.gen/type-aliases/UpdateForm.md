# Type Alias: UpdateForm

> **UpdateForm** = \{ `accentColor?`: `string` \| `null`; `audience?`: [`Audience`](Audience.md); `closesAt?`: `string` \| `null`; `confirmationMessage?`: `string`; `coverFileId?`: `string` \| `null`; `description?`: `string`; `logoFileId?`: `string` \| `null`; `status?`: [`FormStatus`](FormStatus.md); `tallyVisible?`: `boolean`; \}

A change to a form's facts; what is left out stays. The description,
confirmation message and branding take edit, the rest owner. A form is renamed
through the entity mutation router.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accentcolor"></a> `accentColor?` | `string` \| `null` | A new accent color, or `null` for the default. |
| <a id="property-audience"></a> `audience?` | [`Audience`](Audience.md) | Who may respond from now on. |
| <a id="property-closesat"></a> `closesAt?` | `string` \| `null` | When it stops taking responses, or `null` for never. |
| <a id="property-confirmationmessage"></a> `confirmationMessage?` | `string` | Its new confirmation message. |
| <a id="property-coverfileid"></a> `coverFileId?` | `string` \| `null` | A new cover image, or `null` to remove it. |
| <a id="property-description"></a> `description?` | `string` | Its new description. |
| <a id="property-logofileid"></a> `logoFileId?` | `string` \| `null` | A new logo, or `null` to remove it. |
| <a id="property-status"></a> `status?` | [`FormStatus`](FormStatus.md) | Open or close it. |
| <a id="property-tallyvisible"></a> `tallyVisible?` | `boolean` | Whether respondents may read option tallies. |
