#[cfg(test)]
mod test;

use sqlx::types::Uuid;

// updates a thread's archived status to the passed boolean without performing checks
#[tracing::instrument(skip(conn), err)]
pub async fn update_inbox_visible_status(
    conn: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
    inbox_visible: bool,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            inbox_visible = $1,
            updated_at = NOW()
        WHERE
            id = $2 AND
            link_id = $3
        "#,
        inbox_visible,
        thread_id,
        link_id,
    )
    .execute(conn)
    .await?;

    Ok(())
}

#[tracing::instrument(skip(executor), err)]
pub async fn update_thread_read_status<'e, E>(
    executor: E,
    thread_id: Uuid,
    link_id: Uuid,
    is_read: bool,
) -> anyhow::Result<()>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            is_read = $1,
            updated_at = NOW()
        WHERE
            id = $2 AND
            link_id = $3
        "#,
        is_read,
        thread_id,
        link_id,
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Updates a thread's provider_id
#[tracing::instrument(skip(conn), err)]
pub async fn update_thread_provider_id(
    conn: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
    provider_id: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_threads
        SET
            provider_id = $1,
            updated_at = NOW()
        WHERE
            id = $2 AND
            link_id = $3
        "#,
        provider_id,
        thread_id,
        link_id,
    )
    .execute(conn)
    .await?;

    Ok(())
}

/// Recomputes the denormalized `email_threads.has_calendar_attachment` flag
/// from the thread's calendar attachments and saved invitations. Mirrors the
/// CalendarOnly predicate in the email crate's dynamic query builder.
#[tracing::instrument(skip(tx), err)]
pub async fn sync_thread_calendar_flag(
    tx: &mut sqlx::PgConnection,
    thread_db_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_threads t
        SET has_calendar_attachment = calc.has_cal
        FROM (
            SELECT EXISTS (
                SELECT 1
                FROM email_messages m
                JOIN email_attachments a ON a.message_id = m.id
                WHERE m.thread_id = $1
                  AND (a.filename ILIKE '%.ics'
                       OR a.mime_type = 'text/calendar'
                       OR a.mime_type = 'application/ics')
            ) OR EXISTS (
                SELECT 1 FROM email_messages m
                JOIN email_message_calendar_invites i ON i.message_id = m.id
                WHERE m.thread_id = $1
            ) AS has_cal
        ) calc
        WHERE t.id = $1
          AND t.has_calendar_attachment IS DISTINCT FROM calc.has_cal
        "#,
        thread_db_id
    )
    .execute(tx)
    .await?;

    Ok(())
}

/// Recomputes the denormalized `email_threads.is_signal` flag: true iff the
/// thread has a non-TRASH message matching the importance heuristic. Mirrors
/// the Importance(true) predicate in the email crate's dynamic query builder.
/// Macro's own notification emails (`$2` domain) never count as signal,
/// regardless of labels or sender overrides.
#[tracing::instrument(skip(tx), err)]
pub async fn sync_thread_signal_flag(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
) -> anyhow::Result<()> {
    recompute_signal(tx, thread_id).await?;
    Ok(())
}

/// Recomputes importance from normalized provider evidence and sender overrides.
/// Exact address policy overrides domain policy; trash and Macro notification
/// senders remain excluded for both providers.
pub async fn recompute_signal(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(r#"
        UPDATE email_threads t SET is_signal = calc.signal
        FROM (SELECT EXISTS (
            SELECT 1 FROM email_messages m
            JOIN email_message_mailbox_facts facts ON facts.id = m.id
            LEFT JOIN email_contacts c ON c.id = m.from_contact_id
            CROSS JOIN LATERAL (
                SELECT COALESCE(bool_or(f.is_important) FILTER (WHERE lower(f.email_address) = lower(c.email_address)),false) AS address_true,
                    COALESCE(bool_or(NOT f.is_important) FILTER (WHERE lower(f.email_address) = lower(c.email_address)),false) AS address_false,
                    COALESCE(bool_or(f.is_important) FILTER (WHERE lower(f.email_domain) = lower(split_part(c.email_address,'@',2))),false) AS domain_true,
                    COALESCE(bool_or(NOT f.is_important) FILTER (WHERE lower(f.email_domain) = lower(split_part(c.email_address,'@',2))),false) AS domain_false
                FROM email_filters f WHERE f.link_id = m.link_id
            ) rules
            WHERE m.thread_id = $1 AND facts.is_present AND NOT facts.in_trash
                AND lower(split_part(c.email_address,'@',2)) IS DISTINCT FROM $2
                AND (rules.address_true OR (rules.domain_true AND NOT rules.address_false)
                    OR (NOT (rules.address_false OR (rules.domain_false AND NOT rules.address_true)) AND facts.provider_is_primary))
        ) AS signal) calc
        WHERE t.id = $1 AND t.is_signal IS DISTINCT FROM calc.signal
    "#,thread_id,email_utils::MACRO_NOTIFICATION_SENDER_DOMAIN).execute(tx).await?;
    Ok(())
}

/// Recomputes `email_threads.has_received_mail` with the rule unarchive
/// enforces: a message that is neither a draft nor sent, or sent mail
/// addressed back to its own sender.
pub async fn sync_thread_received_mail(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(r#"
        UPDATE email_threads t SET has_received_mail = calc.received
        FROM (SELECT EXISTS (
            SELECT 1 FROM email_messages m
            WHERE m.thread_id = $1 AND NOT m.is_draft AND (NOT m.is_sent OR EXISTS (
                SELECT 1 FROM email_message_recipients r
                JOIN email_contacts recipient ON recipient.id = r.contact_id
                JOIN email_contacts sender ON sender.id = m.from_contact_id
                WHERE r.message_id = m.id AND LOWER(recipient.email_address) = LOWER(sender.email_address)
            ))
        ) AS received) calc
        WHERE t.id = $1 AND t.has_received_mail IS DISTINCT FROM calc.received
    "#,thread_id).execute(tx).await?;
    Ok(())
}

/// Shared thread projection for Gmail labels, Outlook folders, and Macro drafts.
pub async fn recompute_thread_metadata(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    sync_thread_received_mail(tx, thread_id).await?;
    // Keep the Macro-draft and received-mail rules in step with
    // `thread_mail_projections_by_ids` in the email crate.
    sqlx::query!(r#"
        WITH facts AS (
            SELECT m.*, f.in_inbox,f.in_trash,f.in_junk,f.in_sent,
                -- Outlook drafts composed in Macro gain a provider id once synced; their shadow row keeps them Macro drafts.
                m.is_draft AND (m.provider_id IS NULL OR EXISTS (
                    SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id = m.id AND NOT d.delete_requested
                )) AS macro_draft,
                EXISTS (SELECT 1 FROM email_message_recipients r WHERE r.message_id = m.id AND r.contact_id = m.from_contact_id) AS sender_is_recipient
            FROM email_messages m JOIN email_message_mailbox_facts f ON f.id = m.id
            WHERE m.thread_id = $1 AND m.link_id = $2 AND f.is_present
        ), aggregate AS (
            SELECT COALESCE(bool_or(in_inbox AND NOT in_sent),false) AS mailbox_visible,
                COALESCE(bool_or(macro_draft),false) AS has_macro_draft,
                COALESCE(bool_or(in_inbox AND NOT in_trash AND NOT in_junk),false) AS has_inbox,
                COALESCE(bool_and(is_read),true) AS is_read,
                max(internal_date_ts) FILTER (WHERE in_inbox AND NOT is_draft AND (NOT is_sent OR sender_is_recipient)) AS received_ts,
                max(updated_at) FILTER (WHERE macro_draft) AS draft_ts,
                max(internal_date_ts) FILTER (WHERE is_sent AND NOT in_trash) AS outbound_ts,
                greatest(max(internal_date_ts) FILTER (WHERE NOT in_trash AND NOT in_junk),max(updated_at) FILTER (WHERE macro_draft)) AS all_ts
            FROM facts
        ), effective AS (
            -- A Macro draft brings a thread back to the inbox only as a reply to received mail.
            SELECT a.*, a.mailbox_visible OR (t.has_received_mail AND a.has_macro_draft)
                    OR (t.reminder_returned_at IS NOT NULL AND a.has_inbox) AS visible,
                greatest(a.received_ts, CASE WHEN t.has_received_mail THEN a.draft_ts END) AS inbound_ts
            FROM aggregate a JOIN email_threads t ON t.id = $1 AND t.link_id = $2
        )
        UPDATE email_threads t SET inbox_visible = a.visible,is_read = a.is_read,
            latest_inbound_message_ts = a.inbound_ts,latest_outbound_message_ts = a.outbound_ts,
            latest_non_spam_message_ts = a.all_ts,updated_at = now()
        FROM effective a WHERE t.id = $1 AND t.link_id = $2
            AND (t.inbox_visible,t.is_read,t.latest_inbound_message_ts,t.latest_outbound_message_ts,t.latest_non_spam_message_ts)
                IS DISTINCT FROM (a.visible,a.is_read,a.inbound_ts,a.outbound_ts,a.all_ts)
    "#,thread_id,link_id).execute(&mut *tx).await?;
    recompute_signal(tx, thread_id).await
}

/// Compatibility entry point used by existing ingestion callers.
pub async fn update_thread_metadata(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<()> {
    recompute_thread_metadata(tx, thread_id, link_id).await?;
    Ok(())
}
