# Type Alias: SetEmailSyncRequest

> **SetEmailSyncRequest** = \{ `email_sync`: `boolean`; \}

Request body for `PUT /crm/companies/{company_id}/email-sync`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email_sync"></a> `email_sync` | `boolean` | New value for `crm_companies.email_sync`. Purely a read-side visibility/permission gate — `soup` queries and email-permission checks require `email_sync = true` before exposing the company's emails team-wide. Populate continues to write CRM history regardless, so toggling never destroys data and re-enabling never requires a backfill. |
