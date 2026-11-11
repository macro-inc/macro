# Table sizes

Orders of magnitude for MacroDB in production, from the database's table
statistics in November 2026. Use them to size a query review or a migration
review; never query a hosted database to refresh them during a review. Names
are lower-cased as Postgres reports them (`Document` is `document`).

| Rows | Tables |
| --- | --- |
| Over 100 million | `documenttextparts`, `email_message_labels`, `email_message_recipients`, `email_messages`, `email_threads` |
| 10 to 100 million | `contacts_connections`, `email_attachments_sfs`, `bompart`, `entity_access`, `sharepermission`, `document`, `documentpermission`, `documentinstance`, `documenttext`, `email_contacts` |
| 1 to 10 million | `agent_session_log`, `cursor_journal_input`, `frecency_events`, `chatmessage`, `document_email`, `calendar_event_occurrences`, `calendar_change_log`, `userhistory`, `itemlastaccessed`, `email_sfs_mappings`, `calendar_event_attendees`, `documentbom`, `documentview`, `email_message_calendar_invites`, `calendar_event_override_attendees` |
| 100 thousand to 1 million | `notification`, `ai_usage_observation`, `crm_domain_directory`, `chatpermission`, `chat`, `documentinstancemodificationdata`, `comms_message_threads`, `comms_channel_participants`, `user`, `macro_user`, `crm_companies`, `crm_domains`, `rolesonusers`, `userdocumentviewlocation`, `macro_user_info`, `database_change_rows`, `call_record_transcripts`, `project`, `projectpermission`, `comms_entity_mentions`, `foreign_entity` |

A table that is not listed is not known to be small. Treat it as large when it
gains a row per message, event, log line, notification, or per user and item
(`comms_messages`, `user_notification`, and the other `email_*` and
`calendar_*` tables). Tables that hold one row per team, user setting, or
integration are small.

## Skew

Averages hide the tenant that breaks a query:

- One mailbox can hold 40,000 to 50,000 threads and several times as many
  messages and recipients; most hold far fewer.
- A team-scoped query multiplies a per-user cost by the team's size. A team
  can have dozens of members with large mailboxes.
- A filter can match almost everything it is meant to narrow: a company's
  domain can be the mailbox owner's own domain.

Size the review for that tenant.

## Engine

Production runs the Postgres version in
`infra/stacks/macrodb/Pulumi.prod.yaml` (`engine_version`), which is older than
the local and dev servers. See
[Checking query plans](../../../docs/development/database.md#checking-query-plans).
