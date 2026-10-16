# Type Alias: EmailFilters

> **EmailFilters** = \{ `bcc?`: `string`[]; `calendar_only?`: `boolean` \| `null`; `cc?`: `string`[]; `crm_addresses?`: `string`[]; `crm_domains?`: `string`[]; `email_thread_ids?`: `string`[]; `exclude_labels?`: `string`[]; `importance?`: `boolean` \| `null`; `include_labels?`: `string`[]; `is_read?`: `boolean` \| `null`; `link_ids?`: `string`[]; `notification_filters?`: [`NotificationFilters`](NotificationFilters.md); `project_ids?`: `string`[]; `recipients?`: `string`[]; `senders?`: `string`[]; `shared?`: [`SharedEmailFilter`](SharedEmailFilter.md); \}

The email filters used to filter down what emails you search over.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc?` | `string`[] | Email BCC addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by BCC. |
| <a id="property-calendar_only"></a> `calendar_only?` | `boolean` \| `null` | When `Some(true)`, only include threads that have at least one message with an iCalendar attachment (`.ics` filename or `application/ics` mime type). `Some(false)` and `None` apply no constraint. |
| <a id="property-cc"></a> `cc?` | `string`[] | Email CC addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by CC. |
| <a id="property-crm_addresses"></a> `crm_addresses?` | `string`[] | CRM-scoped address filter. When non-empty, expands visibility to every teammate's mailbox and restricts to threads involving any of these fully-qualified addresses. Each address is authorized against `crm_contacts` + `crm_companies` (contact must not be hidden, company must not be hidden, `email_sync` must be true). Mutually exclusive with `crm_domains`. |
| <a id="property-crm_domains"></a> `crm_domains?` | `string`[] | CRM-scoped domain filter. When non-empty, expands visibility to every teammate's mailbox and restricts to threads involving any of these domains (in any of sender/cc/bcc/recipient). Each domain is authorized against `crm_domains` + `crm_companies` (must exist for the caller's team, company must not be hidden, `email_sync` must be true). Mutually exclusive with `crm_addresses`. |
| <a id="property-email_thread_ids"></a> `email_thread_ids?` | `string`[] | Email thread IDs to filter by. Examples: ['thread-uuid-1']. Empty to search all threads. |
| <a id="property-exclude_labels"></a> `exclude_labels?` | `string`[] | Exclude emails that have any of these labels. Supports both Gmail system labels (e.g. "CATEGORY_PROMOTIONS") and user-created labels. Empty to not exclude any labels. Note: SPAM and TRASH emails are not indexed in OpenSearch, so they are already excluded by default. |
| <a id="property-importance"></a> `importance?` | `boolean` \| `null` | Filter by email importance. None to not filter. True to show only important emails (drafts, personal, sent, or uncategorized). False to show only unimportant emails (those categorized as promotions, social, updates, or forums). |
| <a id="property-include_labels"></a> `include_labels?` | `string`[] | Only include emails that have at least one of these labels. Supports both Gmail system labels (e.g. "INBOX", "CATEGORY_PROMOTIONS") and user-created labels (e.g. "github"). Empty to not filter by included labels. Note: SPAM and TRASH emails are not indexed in OpenSearch, so they will never appear in results regardless of this filter. |
| <a id="property-is_read"></a> `is_read?` | `boolean` \| `null` | Filter by the email thread's read flag, independently of notification state. |
| <a id="property-link_ids"></a> `link_ids?` | `string`[] | Restrict to specific inboxes by email_links.id. Empty means "any inbox the caller can access" (soup expands to the full set at the router edge). |
| <a id="property-notification_filters"></a> `notification_filters?` | [`NotificationFilters`](NotificationFilters.md) | Filter by email notification state. |
| <a id="property-project_ids"></a> `project_ids?` | `string`[] | A list of project ids to search within. Empty to ignore project filtering. |
| <a id="property-recipients"></a> `recipients?` | `string`[] | Email Recipient addresses to filter by. Examples: ['user@example.com']. Empty if not filtering by Recipient. |
| <a id="property-senders"></a> `senders?` | `string`[] | Email sender addresses to filter by. Examples: ['user@example.com']. Empty to search all senders. |
| <a id="property-shared"></a> `shared?` | [`SharedEmailFilter`](SharedEmailFilter.md) | Controls whether shared email threads are included in results. Defaults to "exclude" (only the user's own threads). |
