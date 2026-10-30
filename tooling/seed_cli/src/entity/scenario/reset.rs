//! Reset: delete every row a scenario seeded, keyed by the id marker prefix.
//!
//! Every seeded uuid starts with `5eed` + a 4-hex-char scenario hash, so a
//! scenario's rows are exactly the ones matching `LIKE '5eed<scen>%'` (and
//! `LIKE '5eed%'` matches every scenario). Rows the seeder creates with
//! database-generated ids (`SharePermission` and its join tables) are found
//! through their join to a marked entity instead.

#[cfg(test)]
mod test;

/// Build the ordered list of delete statements for a marker prefix.
///
/// The marker must be `5eed` (all scenarios) or `5eed` + 4 hex chars (one
/// scenario); it is interpolated into `LIKE` patterns.
pub fn reset_statements(marker: &str) -> Vec<String> {
    let m = format!("{marker}%");

    vec![
        // SharePermission rows are DB-generated ids; collect them via their
        // join rows to marked entities, delete the joins, then the
        // permissions. Calls are excluded: a call_records delete trigger
        // removes its own SharePermission.
        format!(
            r#"WITH sp_ids AS (
    SELECT dp."sharePermissionId" AS id FROM "DocumentPermission" dp WHERE dp."documentId" LIKE '{m}'
    UNION SELECT cp."sharePermissionId" FROM "ChatPermission" cp WHERE cp."chatId" LIKE '{m}'
    UNION SELECT pp."sharePermissionId" FROM "ProjectPermission" pp WHERE pp."projectId" LIKE '{m}'
    UNION SELECT tp."sharePermissionId" FROM "EmailThreadPermission" tp WHERE tp."threadId" LIKE '{m}'
),
del_document_permissions AS (
    DELETE FROM "DocumentPermission" WHERE "documentId" LIKE '{m}'
),
del_chat_permissions AS (
    DELETE FROM "ChatPermission" WHERE "chatId" LIKE '{m}'
),
del_project_permissions AS (
    DELETE FROM "ProjectPermission" WHERE "projectId" LIKE '{m}'
),
del_email_thread_permissions AS (
    DELETE FROM "EmailThreadPermission" WHERE "threadId" LIKE '{m}'
),
del_channel_share_permissions AS (
    DELETE FROM "ChannelSharePermission"
    WHERE share_permission_id IN (SELECT id FROM sp_ids) OR channel_id LIKE '{m}'
)
DELETE FROM "SharePermission" WHERE id IN (SELECT id FROM sp_ids)"#
        ),
        format!(
            "DELETE FROM entity_access WHERE entity_id::text LIKE '{m}' OR source_id LIKE '{m}'"
        ),
        format!("DELETE FROM entity_properties WHERE entity_id LIKE '{m}'"),
        // Notifications point at seeded items (message notifications carry
        // the channel id); user_notification rows cascade.
        format!("DELETE FROM notification WHERE event_item_id LIKE '{m}'"),
        format!(
            "DELETE FROM comms_entity_mentions WHERE source_entity_id LIKE '{m}' OR entity_id LIKE '{m}'"
        ),
        format!("DELETE FROM comms_activity WHERE channel_id::text LIKE '{m}'"),
        // The call_records delete trigger removes each record's
        // SharePermission; participants and transcripts cascade.
        format!("DELETE FROM call_records WHERE id::text LIKE '{m}'"),
        format!("DELETE FROM calls WHERE id::text LIKE '{m}'"),
        // Participants, messages, attachments, and reactions cascade with
        // the channel.
        format!("DELETE FROM comms_channels WHERE id::text LIKE '{m}'"),
        // Threads, messages, labels, contacts, and macro_user_links cascade
        // with the link.
        format!("DELETE FROM email_links WHERE id::text LIKE '{m}'"),
        format!("DELETE FROM \"Document\" WHERE id LIKE '{m}'"),
        format!("DELETE FROM \"Chat\" WHERE id LIKE '{m}'"),
        format!("DELETE FROM \"Project\" WHERE id LIKE '{m}'"),
        format!("DELETE FROM team_invite WHERE team_id::text LIKE '{m}'"),
        format!("DELETE FROM team_user WHERE team_id::text LIKE '{m}'"),
        // team_crm_settings cascades with the team.
        format!("DELETE FROM team WHERE id::text LIKE '{m}'"),
        format!(
            r#"DELETE FROM "RolesOnUsers" WHERE "userId" IN (SELECT id FROM "User" WHERE "macro_user_id"::text LIKE '{m}')"#
        ),
        format!("DELETE FROM macro_user_email_verification WHERE macro_user_id::text LIKE '{m}'"),
        format!("DELETE FROM macro_user_info WHERE macro_user_id::text LIKE '{m}'"),
        format!(r#"DELETE FROM "User" WHERE "macro_user_id"::text LIKE '{m}'"#),
        format!("DELETE FROM macro_user WHERE id::text LIKE '{m}'"),
    ]
}

/// Statement deleting stale contacts-backfill outbox rows for marked
/// channels. Runs separately because the table only exists once its
/// migration has been applied.
pub fn reset_contacts_outbox_statement(marker: &str) -> String {
    format!("DELETE FROM contacts_backfill_outbox WHERE comms_channel_id::text LIKE '{marker}%'")
}

/// Delete scenario users by email. Needed on top of the marker deletes
/// because accounts created through the signup webhook (so they can log in)
/// carry database-generated ids, not marker-prefixed ones.
pub fn reset_user_statements(emails: &[String]) -> Vec<String> {
    if emails.is_empty() {
        return Vec::new();
    }
    let emails = emails
        .iter()
        .map(|email| format!("'{}'", email.replace('\'', "''")))
        .collect::<Vec<_>>()
        .join(", ");
    let user_ids = format!(r#"SELECT id FROM "User" WHERE email IN ({emails})"#);
    let macro_user_ids = format!("SELECT id FROM macro_user WHERE email IN ({emails})");

    vec![
        format!(r#"DELETE FROM "RolesOnUsers" WHERE "userId" IN ({user_ids})"#),
        format!(
            "DELETE FROM contacts_connections WHERE user1 IN ({user_ids}) OR user2 IN ({user_ids})"
        ),
        format!("DELETE FROM macro_user_email_verification WHERE email IN ({emails})"),
        format!("DELETE FROM macro_user_info WHERE macro_user_id IN ({macro_user_ids})"),
        format!(r#"DELETE FROM "User" WHERE email IN ({emails})"#),
        format!("DELETE FROM macro_user WHERE email IN ({emails})"),
    ]
}
