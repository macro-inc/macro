# Type Alias: EnrollRequest

> **EnrollRequest** = \{ `crmContactIds`: `string`[]; `start`: `string`; `timezone`: `string`; \}

Contacts to enroll.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-crmcontactids"></a> `crmContactIds` | `string`[] | CRM people. |
| <a id="property-start"></a> `start` | `string` | When the first step should go; also fixes the local send time. |
| <a id="property-timezone"></a> `timezone` | `string` | IANA time zone the send time is in. |
