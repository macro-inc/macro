# Type Alias: InitResponse

> **InitResponse** = \{ `backfill_job_id?`: `string` \| `null`; `link_id`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-backfill_job_id"></a> `backfill_job_id?` | `string` \| `null` | Present when init enqueued a backfill job. Absent for cross-user delegation, where the child link's backfill already ran under its own macro_id; present for the self-link bootstrap, where a fresh link is provisioned and backfilled. |
| <a id="property-link_id"></a> `link_id` | `string` | The email_links row id for the now-accessible inbox. For cross-user delegation this is the *existing* child link the caller now delegates over; for the self-link bootstrap and the data-source path it's a freshly upserted row. |
