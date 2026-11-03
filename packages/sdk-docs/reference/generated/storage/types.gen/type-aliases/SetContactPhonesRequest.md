# Type Alias: SetContactPhonesRequest

> **SetContactPhonesRequest** = \{ `phones`: `string`[]; \}

Request body for `PUT /contacts/{contact_id}/phones`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-phones"></a> `phones` | `string`[] | Every number the contact should have, as typed, each with its country code. Formatting is ignored; numbers are stored in E.164. Numbers the contact keeps keep their source. Empty removes them all (400 when one is not a number, or there are more than ten). |
