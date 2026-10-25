//! Atomic send admission and cancellation. Lock order is attempt, draft handle,
//! message, schedule; provider work never holds these locks.
use super::{EmailPgRepo, draft, thread};
use crate::domain::{models::EmailErr, send_attempt::*};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgConnection;
use uuid::Uuid;

mod inbox_move;

async fn lock_attempt(
    tx: &mut PgConnection,
    actor: &MacroUserIdStr<'_>,
    link: Uuid,
    attempt: SendAttemptId,
) -> Result<(), EmailErr> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        format!("email_send:{actor}:{link}:{}", attempt.0)
    )
    .execute(tx)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(())
}

/// Caller holds message/schedule locks and has revoked the previous delivery.
pub(super) async fn cancel_revoked_attempts(
    tx: &mut PgConnection,
    message_ids: &[Uuid],
    link: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"UPDATE email_send_attempts SET cancelled = true
           WHERE message_id = ANY($1) AND link_id = $2
             AND NOT cancelled AND NOT sent AND NOT delivery_unconfirmed"#,
        message_ids,
        link,
    )
    .execute(tx)
    .await?;
    Ok(())
}

struct AttemptRow {
    request: Option<serde_json::Value>,
    created_at: chrono::DateTime<chrono::Utc>,
    link_id: Uuid,
    attempt_id: Uuid,
    message_id: Option<Uuid>,
    thread_id: Option<Uuid>,
    send_time: Option<chrono::DateTime<chrono::Utc>>,
    cancelled: bool,
    sent: bool,
    processing: bool,
    delivery_status: Option<String>,
    delivery_started_at: Option<chrono::DateTime<chrono::Utc>>,
    delivery_claim_id: Option<Uuid>,
    delivery_unconfirmed: bool,
    mailbox_state: Option<String>,
    error_code: Option<String>,
    mailbox_stage: Option<String>,
}

fn attempt_from_row(row: AttemptRow) -> SendAttempt {
    SendAttempt {
        transitioned: false,
        message: None,
        attempt_id: SendAttemptId(row.attempt_id),
        status: if row.cancelled {
            SendAttemptStatus::Cancelled
        } else if row.sent {
            SendAttemptStatus::Sent
        } else if row.delivery_unconfirmed
            || row.error_code.as_deref() == Some("send_unknown")
            || row.mailbox_stage.as_deref() == Some("confirming")
            || row.delivery_status.as_deref() == Some("unconfirmed")
            || (row.delivery_started_at.is_some() && !row.processing)
        {
            SendAttemptStatus::DeliveryUnconfirmed
        } else if row.delivery_status.as_deref() == Some("failed")
            || matches!(
                row.mailbox_state.as_deref(),
                Some("failed" | "conflict" | "cancelled")
            )
        {
            SendAttemptStatus::Failed
        } else if row.processing
            && (row.delivery_claim_id.is_none() || row.delivery_started_at.is_some())
        {
            SendAttemptStatus::Sending
        } else {
            SendAttemptStatus::Accepted
        },
        message_id: row.message_id,
        thread_id: row.thread_id,
        send_time: row.send_time,
    }
}

async fn read_attempt(
    tx: &mut PgConnection,
    actor: &MacroUserIdStr<'_>,
    link: Uuid,
    attempt: SendAttemptId,
    snapshot: Option<&SendSnapshot>,
) -> Result<Option<SendAttempt>, EmailErr> {
    let row = sqlx::query_as!(AttemptRow, r#"SELECT a.request, a.created_at, a.link_id, a.attempt_id, a.message_id, a.thread_id, a.send_time, a.cancelled,
                  (a.sent OR COALESCE(m.is_sent, false)) AS "sent!",
                  COALESCE(s.processing, false) AS "processing!",
                  s.delivery_status AS "delivery_status?", s.delivery_started_at,
                  s.delivery_claim_id,
                  a.delivery_unconfirmed, d.state AS "mailbox_state?",
                  d.error_code, d.checkpoint->>'stage' AS mailbox_stage
           FROM email_send_attempts a
           LEFT JOIN email_messages m ON m.id = a.message_id AND m.link_id = a.link_id
           LEFT JOIN email_scheduled_messages s ON s.message_id = a.message_id AND s.link_id = a.link_id
           LEFT JOIN email_mailbox_drafts d ON d.message_id = a.message_id AND d.link_id = a.link_id
           WHERE a.user_id = $1 AND a.link_id = $2 AND a.attempt_id = $3"#,
        actor.as_ref(), link, attempt.0,
    ).fetch_optional(tx).await.map_err(anyhow::Error::from)?;
    let Some(row) = row else {
        return Ok(None);
    };
    if let (Some(request), Some(snapshot)) = (row.request.as_ref(), snapshot)
        && !snapshot
            .matches_approved_request(request)
            .map_err(anyhow::Error::from)?
    {
        return Err(EmailErr::SendAttemptConflict);
    }
    Ok(Some(attempt_from_row(row)))
}

impl EmailSendRepo for EmailPgRepo {
    async fn pending_send_attempts(
        &self,
        actor: &MacroUserIdStr<'_>,
        link_ids: &[Uuid],
        after: Option<&SendAttemptCursor>,
    ) -> Result<Vec<(SendAttemptCursor, SendAttempt)>, EmailErr> {
        let rows = sqlx::query_as!(AttemptRow, r#"SELECT a.request, a.created_at, a.link_id, a.attempt_id, a.message_id, a.thread_id, a.send_time, a.cancelled,
                  (a.sent OR COALESCE(m.is_sent, false)) AS "sent!",
                  COALESCE(s.processing, false) AS "processing!",
                  s.delivery_status AS "delivery_status?", s.delivery_started_at,
                  s.delivery_claim_id,
                  a.delivery_unconfirmed, d.state AS "mailbox_state?",
                  d.error_code, d.checkpoint->>'stage' AS mailbox_stage
           FROM email_send_attempts a
           LEFT JOIN email_messages m ON m.id = a.message_id AND m.link_id = a.link_id
           LEFT JOIN email_scheduled_messages s ON s.message_id = a.message_id AND s.link_id = a.link_id
           LEFT JOIN email_mailbox_drafts d ON d.message_id = a.message_id AND d.link_id = a.link_id
               WHERE a.user_id = $1 AND a.link_id = ANY($2) AND NOT a.cancelled AND NOT a.sent
                 AND ($3::timestamptz IS NULL OR (a.created_at, a.link_id, a.attempt_id) < ($3, $4, $5))
               ORDER BY a.created_at DESC, a.link_id DESC, a.attempt_id DESC LIMIT 51"#,
            actor.as_ref(), link_ids, after.map(|cursor| cursor.created_at),
            after.map(|cursor| cursor.link_id), after.map(|cursor| cursor.attempt_id),
        ).fetch_all(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    SendAttemptCursor {
                        created_at: row.created_at,
                        link_id: row.link_id,
                        attempt_id: row.attempt_id,
                    },
                    attempt_from_row(row),
                )
            })
            .collect())
    }

    async fn send_message_rows(
        &self,
        message_ids: &[Uuid],
        link_ids: &[Uuid],
    ) -> Result<Vec<crate::domain::models::MessageRow>, EmailErr> {
        let rows = sqlx::query_as!(super::db_types::DbMessageRow,
            r#"SELECT draft_generation, id, provider_id, thread_id, provider_thread_id, replying_to_id,
               global_id, link_id, provider_history_id, internal_date_ts, snippet,
               size_estimate, subject, sent_at, has_attachments, is_read, is_starred,
               is_sent, is_draft, body_text, body_html_sanitized, body_macro,
               headers_jsonb, created_at, updated_at
               FROM email_messages WHERE (id, link_id) IN (SELECT * FROM unnest($1::uuid[], $2::uuid[]))"#,
            message_ids, link_ids,
        ).fetch_all(&self.pool).await.map_err(anyhow::Error::from)?;
        Ok(rows.into_iter().map(Into::into).collect())
    }
    async fn send_message_row(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<crate::domain::models::MessageRow>, EmailErr> {
        let row = sqlx::query_as!(
            super::db_types::DbMessageRow,
            r#"SELECT draft_generation, id, provider_id, thread_id, provider_thread_id, replying_to_id,
               global_id, link_id, provider_history_id, internal_date_ts, snippet,
               size_estimate, subject, sent_at, has_attachments, is_read, is_starred,
               is_sent, is_draft, body_text, body_html_sanitized, body_macro,
               headers_jsonb, created_at, updated_at
               FROM email_messages WHERE id = $1 AND link_id = $2"#,
            message_id,
            link_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(row.map(Into::into))
    }
    async fn read_send_attempt(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        attempt: SendAttemptId,
        snapshot: Option<&SendSnapshot>,
    ) -> Result<Option<SendAttempt>, EmailErr> {
        let mut connection = self.pool.acquire().await.map_err(anyhow::Error::from)?;
        read_attempt(&mut connection, actor, link, attempt, snapshot).await
    }

    async fn admit_send(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        attempt: SendAttemptId,
        mut prepared: PreparedSend,
    ) -> Result<SendAttempt, EmailErr> {
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        lock_attempt(&mut tx, actor, link, attempt).await?;
        if let Some(existing) =
            read_attempt(&mut tx, actor, link, attempt, Some(&prepared.snapshot)).await?
        {
            return Ok(existing);
        }
        if let Some(source) = prepared.source_inbox {
            inbox_move::move_for_admission(
                &mut tx,
                &prepared.message,
                link,
                source,
                &mut prepared.new_thread,
            )
            .await?;
        }
        let ids = draft::insert_message_in_transaction(
            &mut tx,
            &prepared.message,
            &prepared.contacts,
            link,
            prepared.new_thread,
            false,
        )
        .await?
        .ok_or(EmailErr::MessageDeliveryConflict(prepared.message.db_id))?;
        sqlx::query!(
            "UPDATE email_messages SET draft_generation = draft_generation + 1 WHERE id = $1 AND link_id = $2",
            ids.message_db_id, link,
        ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        // Successful insertion proves the prior delivery was revoked. Retire
        // orphaned attempts atomically so their delayed cancellations stay inert.
        cancel_revoked_attempts(&mut tx, &[ids.message_db_id], link)
            .await
            .map_err(anyhow::Error::from)?;
        // The message lock serializes edits. Verify the approved attachment set
        // inside admission, never silently send missing or newly added files.
        let uploaded = sqlx::query_scalar!(
            "SELECT id FROM email_attachments_drafts WHERE draft_id = $1 ORDER BY id",
            ids.message_db_id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        let forwarded = sqlx::query_scalar!("SELECT attachment_id AS \"attachment_id!\" FROM email_draft_provider_attachment_ids($1, $2) ORDER BY attachment_id", ids.message_db_id, link)
            .fetch_all(&mut *tx).await.map_err(anyhow::Error::from)?;
        let mut expected_uploaded = prepared.snapshot.attachment_ids.clone();
        let mut expected_forwarded = prepared.snapshot.forwarded_attachment_ids.clone();
        expected_uploaded.sort_unstable();
        expected_forwarded.sort_unstable();
        if uploaded != expected_uploaded || forwarded != expected_forwarded {
            return Err(EmailErr::InvalidSendSnapshot(
                "attachments changed; review the draft".into(),
            ));
        }
        let send_time = prepared.snapshot.message.send_time.unwrap_or_else(|| {
            chrono::Utc::now() + chrono::Duration::seconds(prepared.undo_delay_secs.into())
        });
        sqlx::query!("UPDATE email_scheduled_messages SET send_time = $1 WHERE message_id = $2 AND link_id = $3", send_time, ids.message_db_id, link)
            .execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        let sender = sqlx::query!(
            r#"SELECT COALESCE(c.email_address, l.email_address) AS "email_address!", COALESCE(m.from_name, c.name) AS name, c.sfs_photo_url
               FROM email_messages m JOIN email_links l ON l.id = m.link_id
               LEFT JOIN email_contacts c ON c.id = m.from_contact_id
               WHERE m.id = $1 AND m.link_id = $2"#,
            ids.message_db_id,
            link,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        let mut content_message = prepared.message;
        content_message.db_id = ids.message_db_id;
        content_message.thread_db_id = ids.thread_db_id;
        content_message.send_time = Some(send_time);
        let prepared_content = serde_json::to_value(PreparedSendContent {
            message: content_message,
            sender: crate::domain::models::ContactInfo {
                email: sender.email_address,
                name: sender.name,
                photo_url: sender.sfs_photo_url,
            },
        })
        .map_err(anyhow::Error::from)?;
        let request = prepared
            .snapshot
            .persisted_request()
            .map_err(anyhow::Error::from)?;
        sqlx::query!(
            r#"INSERT INTO email_send_attempts (user_id, link_id, attempt_id, request, message_id, thread_id, send_time, restore_body_html, restore_body_text, restore_body_macro, prepared_content, draft_handles, draft_link_ids)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 ARRAY(SELECT client_id FROM email_draft_client_ids WHERE message_id=$5
                       UNION SELECT $5 UNION SELECT $12::uuid WHERE $12 IS NOT NULL),
                 ARRAY(SELECT link_id FROM email_draft_client_ids WHERE message_id=$5
                       UNION SELECT $2 UNION SELECT $13::uuid WHERE $13 IS NOT NULL))"#,
            actor.as_ref(), link, attempt.0, request, ids.message_db_id, ids.thread_db_id, send_time,
            prepared.restore_html, prepared.restore_text, prepared.restore_macro,
            prepared_content,
            prepared.snapshot.message.db_id, prepared.source_inbox.map(|source| source.link_id),
        ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        tx.commit().await.map_err(anyhow::Error::from)?;
        Ok(SendAttempt {
            transitioned: true,
            message: None,
            attempt_id: attempt,
            status: SendAttemptStatus::Accepted,
            message_id: Some(ids.message_db_id),
            thread_id: Some(ids.thread_db_id),
            send_time: Some(send_time),
        })
    }

    async fn cancel_send(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        attempt: SendAttemptId,
    ) -> Result<SendAttempt, EmailErr> {
        let mut tx = self.pool.begin().await.map_err(anyhow::Error::from)?;
        lock_attempt(&mut tx, actor, link, attempt).await?;
        let existing = read_attempt(&mut tx, actor, link, attempt, None).await?;
        if let Some(existing) = &existing {
            if matches!(
                existing.status,
                SendAttemptStatus::Cancelled
                    | SendAttemptStatus::Sent
                    | SendAttemptStatus::DeliveryUnconfirmed
            ) {
                return Ok(existing.clone());
            }
            if let Some(message_id) = existing.message_id {
                // Outlook workers lock mailbox, message, then schedule. Match
                // that order while revoking their pending draft revision.
                sqlx::query!(
                    "SELECT id FROM email_links WHERE id = $1 AND provider = 'OUTLOOK' FOR UPDATE",
                    link,
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(anyhow::Error::from)?;
                let message = sqlx::query!(
                    "SELECT is_sent FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
                    message_id,
                    link
                )
                .fetch_optional(&mut *tx)
                .await
                .map_err(anyhow::Error::from)?;
                let schedule = sqlx::query!("SELECT sent, processing, delivery_status, delivery_started_at, delivery_claim_id FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2 FOR UPDATE", message_id, link)
                    .fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?;
                // Delivery and deletion can commit while we wait for the message
                // lock. Its absence does not mean the send was never delivered.
                let current = read_attempt(&mut tx, actor, link, attempt, None)
                    .await?
                    .ok_or(EmailErr::MessageNotFound(message_id))?;
                if matches!(
                    current.status,
                    SendAttemptStatus::Cancelled
                        | SendAttemptStatus::Sent
                        | SendAttemptStatus::DeliveryUnconfirmed
                ) || message.is_some_and(|m| m.is_sent)
                    || schedule.as_ref().is_some_and(|s| {
                        s.sent
                            || (s.delivery_status != "failed"
                                && ((s.processing && s.delivery_claim_id.is_none())
                                    || s.delivery_started_at.is_some()
                                    || s.delivery_status == "unconfirmed"))
                    })
                {
                    return Ok(current);
                }
                // Holding the schedule lock serializes cancellation with the
                // managed worker's submission boundary. Deletion revokes its
                // claim before any provider submission can begin.
                sqlx::query!(
                    "DELETE FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2",
                    message_id,
                    link
                )
                .execute(&mut *tx)
                .await
                .map_err(anyhow::Error::from)?;
                sqlx::query!(
                    r#"UPDATE email_messages m SET is_draft = true, draft_generation = m.draft_generation + 1, body_html_sanitized = a.restore_body_html,
                       body_text = a.restore_body_text, body_macro = a.restore_body_macro, updated_at = NOW()
                       FROM email_send_attempts a WHERE a.user_id = $1 AND a.link_id = $2 AND a.attempt_id = $3
                       AND m.id = a.message_id AND m.link_id = a.link_id AND NOT m.is_sent"#,
                    actor.as_ref(), link, attempt.0,
                ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
                draft::snapshot_outlook_draft(&mut tx, message_id, link, actor.as_ref())
                    .await
                    .map_err(anyhow::Error::from)?;
                if let Some(thread_id) = existing.thread_id {
                    thread::update_thread_metadata(&mut tx, thread_id, link)
                        .await
                        .map_err(anyhow::Error::from)?;
                }
            }
        }
        sqlx::query!(
            r#"INSERT INTO email_send_attempts (user_id, link_id, attempt_id, cancelled) VALUES ($1, $2, $3, true)
               ON CONFLICT (user_id, link_id, attempt_id) DO UPDATE SET cancelled = true"#,
            actor.as_ref(), link, attempt.0,
        ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        let mut result = read_attempt(&mut tx, actor, link, attempt, None)
            .await?
            .expect("attempt was inserted in this transaction");
        result.transitioned = true;
        tx.commit().await.map_err(anyhow::Error::from)?;
        Ok(result)
    }
}
