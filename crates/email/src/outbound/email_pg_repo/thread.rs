use crate::domain::models::{
    EmailPreview, EmailThreadDraftState, EmailThreadMailCacheFacts, EmailThreadMailPreviews,
    EmailThreadMailProjection, EmailThreadMetadata, MessageRow, ThreadRow,
};
use sqlx::{PgPool, types::Json};
use uuid::Uuid;

use super::db_types::{DbMessageRow, DbThreadRow};

#[tracing::instrument(err, skip(pool))]
pub(super) async fn thread_by_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> Result<Option<ThreadRow>, sqlx::Error> {
    let row: Option<DbThreadRow> = sqlx::query_as!(
        DbThreadRow,
        r#"
        SELECT t.id, t.provider_id, t.link_id, t.inbox_visible, t.is_read,
               t.latest_inbound_message_ts, t.latest_outbound_message_ts,
               t.latest_non_spam_message_ts, t.created_at, t.updated_at,
               t.project_id
        FROM email_threads t
        WHERE t.id = $1
        "#,
        thread_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(ThreadRow::from))
}

#[tracing::instrument(err, skip(pool, thread_ids))]
pub(super) async fn thread_metadata_by_ids(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<EmailThreadMetadata>, sqlx::Error> {
    if thread_ids.is_empty() {
        return Ok(Vec::new());
    }

    sqlx::query_as!(
        EmailThreadMetadata,
        r#"
        SELECT
            id AS "thread_id!",
            link_id,
            latest_inbound_message_ts,
            reminder_returned_at
        FROM email_threads
        WHERE id = ANY($1)
        "#,
        thread_ids,
    )
    .fetch_all(pool)
    .await
}

#[tracing::instrument(err, skip(pool, thread_ids))]
pub(super) async fn thread_mail_projections_by_ids(
    pool: &PgPool,
    viewer: macro_user_id::user_id::MacroUserIdStr<'_>,
    thread_ids: &[Uuid],
) -> Result<Vec<EmailThreadMailProjection>, sqlx::Error> {
    if thread_ids.is_empty() {
        return Ok(Vec::new());
    }
    // Called only for receipt-authorized IDs. Each lateral is an indexed,
    // per-thread top-one probe. The draft baseline aggregates message metadata
    // for the requested threads; it never loads message bodies.
    //
    // `is_signal` restates the importance heuristic of `sync_thread_signal_flag`
    // (below) and `resync_signal_flags_for_sender` (email_filter.rs) over the
    // pre-aggregated `rules` lateral; `draft_sender_is_signal` (domain
    // service/user.rs) mirrors its sender-override precedence. Change all four
    // together.
    let rows = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text AS source_id FROM comms_channel_participants cp
            WHERE cp.user_id = $2 AND cp.left_at IS NULL
            UNION ALL SELECT team_id::text FROM team_user WHERE user_id = $2
            UNION ALL SELECT $2::text
        ), message_facts AS (
            SELECT m.id, m.thread_id, m.is_draft, m.is_read,
                m.is_draft AND m.provider_id IS NULL AS macro_draft,
                ((facts.in_inbox AND NOT facts.in_sent)
                    OR (m.is_draft AND m.provider_id IS NULL)) AS inbox_visible,
                NOT facts.in_trash
                AND LOWER(SPLIT_PART(c.email_address, '@', 2)) IS DISTINCT FROM $3
                AND (
                    rules.address_true OR (rules.domain_true AND NOT rules.address_false)
                    OR (NOT (rules.address_false OR (rules.domain_false AND NOT rules.address_true))
                        AND facts.provider_is_primary)
                ) AS is_signal,
                (EXISTS (SELECT 1 FROM email_attachments a WHERE a.message_id = m.id
                    AND (a.filename ILIKE '%.ics' OR a.mime_type IN ('text/calendar','application/ics'))
                ) OR EXISTS (
                    SELECT 1 FROM email_message_calendar_invites i WHERE i.message_id = m.id
                )) AS has_calendar_attachment,
                GREATEST(
                    CASE WHEN facts.in_inbox AND (
                        NOT (m.is_draft OR m.is_sent) OR EXISTS (
                            SELECT 1 FROM email_message_recipients r
                            WHERE r.message_id = m.id AND r.contact_id = m.from_contact_id
                        )) THEN m.internal_date_ts END,
                    CASE WHEN m.is_draft AND m.provider_id IS NULL THEN m.updated_at END
                ) AS inbound_ts,
                GREATEST(
                    CASE WHEN NOT (facts.in_junk OR facts.in_trash) THEN m.internal_date_ts END,
                    CASE WHEN m.is_draft AND m.provider_id IS NULL THEN m.updated_at END
                ) AS all_ts,
                CASE WHEN m.is_sent AND NOT facts.in_trash THEN m.internal_date_ts END AS sent_ts,
                CASE WHEN NOT facts.in_trash THEN COALESCE(m.internal_date_ts, m.created_at) END AS preview_ts,
                CASE WHEN NOT facts.in_trash THEN jsonb_build_object(
                    'id', m.id, 'subject', m.subject, 'snippet', m.snippet, 'is_draft', m.is_draft,
                    'sender_email', c.email_address, 'sender_name', c.name, 'sender_photo_url', c.sfs_photo_url
                ) END AS preview
            FROM email_messages m
            LEFT JOIN email_contacts c ON c.id = m.from_contact_id
            JOIN email_message_mailbox_facts facts ON facts.id = m.id
            CROSS JOIN LATERAL (
                SELECT COALESCE(bool_or(f.is_important) FILTER (WHERE LOWER(f.email_address) = LOWER(c.email_address)), false) AS address_true,
                    COALESCE(bool_or(NOT f.is_important) FILTER (WHERE LOWER(f.email_address) = LOWER(c.email_address)), false) AS address_false,
                    COALESCE(bool_or(f.is_important) FILTER (WHERE LOWER(f.email_domain) = LOWER(SPLIT_PART(c.email_address, '@', 2))), false) AS domain_true,
                    COALESCE(bool_or(NOT f.is_important) FILTER (WHERE LOWER(f.email_domain) = LOWER(SPLIT_PART(c.email_address, '@', 2))), false) AS domain_false
                FROM email_filters f WHERE f.link_id = m.link_id
            ) rules
            WHERE m.thread_id = ANY($1) AND facts.is_present
        ), draft_states AS (
            SELECT thread_id, jsonb_build_object(
                'baseline', jsonb_build_object(
                    'message_count', count(*) FILTER (WHERE NOT is_draft),
                    'inbox_visible', COALESCE(bool_or(inbox_visible) FILTER (WHERE NOT is_draft), false),
                    'is_read', COALESCE(bool_and(is_read) FILTER (WHERE NOT is_draft), true),
                    'is_signal', COALESCE(bool_or(is_signal) FILTER (WHERE NOT is_draft), false),
                    'has_calendar_attachment', COALESCE(bool_or(has_calendar_attachment) FILTER (WHERE NOT is_draft), false),
                    'latest_inbound_message_ts', max(inbound_ts) FILTER (WHERE NOT is_draft),
                    'latest_non_spam_message_ts', max(all_ts) FILTER (WHERE NOT is_draft),
                    'latest_outbound_message_ts', max(sent_ts) FILTER (WHERE NOT is_draft),
                    'preview', (array_agg(preview ORDER BY preview_ts DESC, id DESC) FILTER (WHERE NOT is_draft AND preview IS NOT NULL))[1],
                    'preview_ts', max(preview_ts) FILTER (WHERE NOT is_draft)
                ),
                'drafts', COALESCE(jsonb_agg(jsonb_build_object(
                    'id', id, 'macro_draft', macro_draft, 'facts', jsonb_build_object(
                        'message_count', 1, 'inbox_visible', inbox_visible, 'is_read', is_read,
                        'is_signal', is_signal, 'has_calendar_attachment', has_calendar_attachment,
                        'latest_inbound_message_ts', inbound_ts, 'latest_non_spam_message_ts', all_ts,
                        'latest_outbound_message_ts', sent_ts, 'preview', preview, 'preview_ts', preview_ts
                    )
                ) ORDER BY id) FILTER (WHERE is_draft), '[]'::jsonb)
            ) AS state FROM message_facts GROUP BY thread_id
        )
        SELECT t.id AS "thread_id!", ds.state AS "draft_state?: Json<EmailThreadDraftState>",
            t.latest_non_spam_message_ts, t.latest_outbound_message_ts,
            t.has_calendar_attachment,
            EXISTS (SELECT 1 FROM entity_access ea
                WHERE ea.entity_id = t.id AND ea.entity_type = 'email_thread'
                  AND ea.source_id = ANY(SELECT source_id FROM user_source_ids)
            ) AS "has_thread_share!",
            CASE WHEN am.id IS NOT NULL THEN jsonb_build_object(
                'id', am.id, 'subject', am.subject, 'snippet', am.snippet, 'is_draft', am.is_draft,
                'sender_email', ac.email_address, 'sender_name', ac.name, 'sender_photo_url', ac.sfs_photo_url
            ) END AS "all_preview?: Json<EmailPreview>",
            CASE WHEN dm.id IS NOT NULL THEN jsonb_build_object(
                'id', dm.id, 'subject', dm.subject, 'snippet', dm.snippet, 'is_draft', dm.is_draft,
                'sender_email', dc.email_address, 'sender_name', dc.name, 'sender_photo_url', dc.sfs_photo_url
            ) END AS "draft_preview?: Json<EmailPreview>",
            CASE WHEN sm.id IS NOT NULL THEN jsonb_build_object(
                'id', sm.id, 'subject', sm.subject, 'snippet', sm.snippet, 'is_draft', sm.is_draft,
                'sender_email', sc.email_address, 'sender_name', sc.name, 'sender_photo_url', sc.sfs_photo_url
            ) END AS "sent_preview?: Json<EmailPreview>"
        FROM email_threads t
        LEFT JOIN draft_states ds ON ds.thread_id = t.id
        LEFT JOIN LATERAL (
            SELECT m.id, m.subject, m.snippet, m.is_draft, m.from_contact_id
            FROM email_messages m WHERE m.thread_id = t.id AND EXISTS (SELECT 1 FROM email_message_mailbox_facts mf WHERE mf.id = m.id AND mf.is_present AND NOT mf.in_trash) ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC, m.id DESC LIMIT 1
        ) am ON TRUE
        LEFT JOIN email_contacts ac ON ac.id = am.from_contact_id
        LEFT JOIN LATERAL (
            SELECT m.id, m.subject, m.snippet, m.is_draft, m.from_contact_id
            FROM email_messages m WHERE m.thread_id = t.id AND m.is_draft AND EXISTS (SELECT 1 FROM email_message_mailbox_facts mf WHERE mf.id = m.id AND mf.is_present AND NOT mf.in_trash) ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC, m.id DESC LIMIT 1
        ) dm ON TRUE
        LEFT JOIN email_contacts dc ON dc.id = dm.from_contact_id
        LEFT JOIN LATERAL (
            SELECT m.id, m.subject, m.snippet, m.is_draft, m.from_contact_id
            FROM email_messages m WHERE m.thread_id = t.id AND m.is_sent AND EXISTS (SELECT 1 FROM email_message_mailbox_facts mf WHERE mf.id = m.id AND mf.is_present AND NOT mf.in_trash) ORDER BY COALESCE(m.internal_date_ts, m.created_at) DESC, m.id DESC LIMIT 1
        ) sm ON TRUE
        LEFT JOIN email_contacts sc ON sc.id = sm.from_contact_id
        WHERE t.id = ANY($1)
        "#,
        thread_ids, viewer.as_ref(), email_utils::MACRO_NOTIFICATION_SENDER_DOMAIN,
    ).fetch_all(pool).await?;
    Ok(rows
        .into_iter()
        .map(|row| EmailThreadMailProjection {
            thread_id: row.thread_id,
            draft_state: row.draft_state.map(|Json(state)| state),
            cache_facts: EmailThreadMailCacheFacts {
                latest_non_spam_message_ts: row.latest_non_spam_message_ts,
                latest_outbound_message_ts: row.latest_outbound_message_ts,
                has_calendar_attachment: row.has_calendar_attachment,
                has_thread_share: row.has_thread_share,
            },
            previews: EmailThreadMailPreviews {
                all: row.all_preview.map(|Json(preview)| preview),
                draft: row.draft_preview.map(|Json(preview)| preview),
                sent: row.sent_preview.map(|Json(preview)| preview),
            },
        })
        .collect())
}

#[tracing::instrument(err, skip(pool))]
pub(super) async fn messages_by_thread_id_paginated(
    pool: &PgPool,
    thread_id: Uuid,
    offset: i64,
    limit: i64,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbMessageRow,
        r#"
        SELECT
            id, provider_id, thread_id, provider_thread_id, replying_to_id,
            global_id, link_id, provider_history_id, internal_date_ts, snippet,
            size_estimate, subject, sent_at, has_attachments, is_read, is_starred,
            is_sent, is_draft, body_text, body_html_sanitized, body_macro,
            headers_jsonb, created_at, updated_at
        FROM email_messages
        WHERE thread_id = $1
        ORDER BY COALESCE(internal_date_ts, sent_at, created_at) DESC, id DESC
        LIMIT $2 OFFSET $3
        "#,
        thread_id,
        limit,
        offset,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(MessageRow::from).collect())
}

/// Fetch the newest non-draft content message in each thread using an
/// effective timestamp and deterministic ID tiebreaker.
#[allow(
    clippy::disallowed_methods,
    reason = "runtime lateral query is covered by repository integration tests"
)]
pub(super) async fn latest_content_message_rows(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let rows = sqlx::query_as::<_, DbMessageRow>(
        r#"
        SELECT
            message.id, message.provider_id, message.thread_id,
            message.provider_thread_id, message.replying_to_id,
            message.global_id, message.link_id, message.provider_history_id,
            message.internal_date_ts, message.snippet, message.size_estimate,
            message.subject, message.sent_at, message.has_attachments,
            message.is_read, message.is_starred, message.is_sent,
            message.is_draft, message.body_text, message.body_html_sanitized,
            message.body_macro, message.headers_jsonb, message.created_at,
            message.updated_at
        FROM UNNEST($1::uuid[]) AS requested(thread_id)
        CROSS JOIN LATERAL (
            SELECT
                id, provider_id, thread_id, provider_thread_id, replying_to_id,
                global_id, link_id, provider_history_id, internal_date_ts,
                snippet, size_estimate, subject, sent_at, has_attachments,
                is_read, is_starred, is_sent, is_draft, body_text,
                body_html_sanitized, body_macro, headers_jsonb, created_at,
                updated_at
            FROM email_messages
            WHERE thread_id = requested.thread_id
              AND is_draft = false
            ORDER BY COALESCE(internal_date_ts, sent_at, created_at) DESC,
                     id DESC
            LIMIT 1
        ) AS message
        "#,
    )
    .bind(thread_ids)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(MessageRow::from).collect())
}

/// Find macro drafts that reply to any of the given messages but live in a
/// different thread within one of the accessible inboxes. These are reply drafts
/// the user moved to another of their inboxes by switching the sender; surfacing
/// them lets the original conversation reopen the draft with its sender.
pub(super) async fn cross_inbox_reply_drafts(
    pool: &PgPool,
    replying_to_ids: &[Uuid],
    link_ids: &[Uuid],
    exclude_thread_id: Uuid,
) -> Result<Vec<MessageRow>, sqlx::Error> {
    let rows = sqlx::query_as!(
        DbMessageRow,
        r#"
        SELECT
            id, provider_id, thread_id, provider_thread_id, replying_to_id,
            global_id, link_id, provider_history_id, internal_date_ts, snippet,
            size_estimate, subject, sent_at, has_attachments, is_read, is_starred,
            is_sent, is_draft, body_text, body_html_sanitized, body_macro,
            headers_jsonb, created_at, updated_at
        FROM email_messages
        WHERE is_draft = true
          AND provider_id IS NULL
          AND replying_to_id = ANY($1)
          AND link_id = ANY($2)
          AND thread_id <> $3
        "#,
        replying_to_ids,
        link_ids,
        exclude_thread_id,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(MessageRow::from).collect())
}

/// Insert a new thread record within a transaction.
///
/// On conflict the update is skipped entirely when it would be a no-op
/// (incoming `latest_inbound_message_ts` is NULL or unchanged), so redundant
/// inserts neither rewrite the row nor wipe a populated timestamp with NULL.
pub(super) async fn insert_thread(
    tx: &mut sqlx::PgConnection,
    thread: &ThreadRow,
    link_id: Uuid,
) -> Result<Uuid, sqlx::Error> {
    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read,
                             latest_inbound_message_ts, latest_outbound_message_ts,
                             latest_non_spam_message_ts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (link_id, provider_id) WHERE provider_id IS NOT NULL DO UPDATE
        SET
            latest_inbound_message_ts = EXCLUDED.latest_inbound_message_ts,
            updated_at = NOW()
        WHERE
            EXCLUDED.latest_inbound_message_ts IS NOT NULL AND
            email_threads.latest_inbound_message_ts IS DISTINCT FROM EXCLUDED.latest_inbound_message_ts
        RETURNING id
        "#,
        thread.db_id,
        thread.provider_id,
        link_id,
        thread.inbox_visible,
        thread.is_read,
        thread.latest_inbound_message_ts,
        thread.latest_outbound_message_ts,
        thread.latest_non_spam_message_ts,
    )
    .fetch_optional(&mut *tx)
    .await?;

    if let Some(id) = result {
        return Ok(id);
    }

    // The conflicting row already holds this data; fetch its id.
    sqlx::query_scalar!(
        r#"
        SELECT id FROM email_threads
        WHERE link_id = $1 AND provider_id = $2
        "#,
        link_id,
        thread.provider_id,
    )
    .fetch_one(tx)
    .await
}

/// Both repositories use the same normalized metadata projection.
pub(super) async fn update_thread_metadata(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    thread_id: Uuid,
    link_id: Uuid,
) -> Result<(), sqlx::Error> {
    email_db_client::threads::update::recompute_thread_metadata(tx, thread_id, link_id).await
}

#[cfg(test)]
pub(super) async fn sync_thread_signal_flag(
    tx: &mut sqlx::PgConnection,
    thread_id: Uuid,
) -> Result<(), sqlx::Error> {
    email_db_client::threads::update::recompute_signal(tx, thread_id).await
}

#[tracing::instrument(err, skip(executor))]
pub(super) async fn update_thread_read_status(
    executor: impl sqlx::PgExecutor<'_>,
    thread_id: Uuid,
    link_id: Uuid,
    is_read: bool,
) -> Result<(), sqlx::Error> {
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

/// Update the project assignment for a thread. Returns `false` if the thread was not found.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn update_thread_project(
    pool: &PgPool,
    thread_id: Uuid,
    project_id: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        UPDATE email_threads
        SET project_id = $2, updated_at = NOW()
        WHERE id = $1
        "#,
        thread_id,
        project_id,
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Get the current project_id for a thread.
#[tracing::instrument(err, skip(pool))]
pub(super) async fn get_thread_project_id(
    pool: &PgPool,
    thread_id: Uuid,
) -> Result<Option<String>, sqlx::Error> {
    let row: Option<Option<String>> = sqlx::query_scalar!(
        r#"
        SELECT project_id
        FROM email_threads
        WHERE id = $1
        "#,
        thread_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.flatten())
}

/// Upsert user history for thread interaction tracking.
pub(super) async fn upsert_user_history(
    tx: &mut sqlx::PgConnection,
    link_id: Uuid,
    thread_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (link_id, thread_id)
        DO UPDATE SET
            updated_at = NOW()
        "#,
        link_id,
        thread_id,
    )
    .execute(tx)
    .await?;

    Ok(())
}
