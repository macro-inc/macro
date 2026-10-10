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

async fn read_attempt(
    tx: &mut PgConnection,
    actor: &MacroUserIdStr<'_>,
    link: Uuid,
    attempt: SendAttemptId,
    snapshot: Option<&SendSnapshot>,
) -> Result<Option<SendAttempt>, EmailErr> {
    let row = sqlx::query!(
        r#"SELECT a.request, a.message_id, a.thread_id, a.send_time, a.cancelled,
                  (a.sent OR COALESCE(m.is_sent, false)) AS "sent!",
                  COALESCE(s.processing, false) AS "processing!",
                  s.delivery_status AS "delivery_status?", s.delivery_started_at,
                  s.delivery_claim_id,
                  a.delivery_unconfirmed
           FROM email_send_attempts a
           LEFT JOIN email_messages m ON m.id = a.message_id AND m.link_id = a.link_id
           LEFT JOIN email_scheduled_messages s ON s.message_id = a.message_id AND s.link_id = a.link_id
           WHERE a.user_id = $1 AND a.link_id = $2 AND a.attempt_id = $3"#,
        actor.as_ref(), link, attempt.0,
    ).fetch_optional(tx).await.map_err(anyhow::Error::from)?;
    let Some(row) = row else {
        return Ok(None);
    };
    if let (Some(request), Some(snapshot)) = (row.request, snapshot)
        && request != serde_json::to_value(snapshot).map_err(anyhow::Error::from)?
    {
        return Err(EmailErr::SendAttemptConflict);
    }
    Ok(Some(SendAttempt {
        transitioned: false,
        message: None,
        attempt_id: attempt,
        status: if row.cancelled {
            SendAttemptStatus::Cancelled
        } else if row.sent {
            SendAttemptStatus::Sent
        } else if row.delivery_status.as_deref() == Some("failed") {
            SendAttemptStatus::Failed
        } else if row.delivery_unconfirmed
            || row.delivery_status.as_deref() == Some("unconfirmed")
            || (row.delivery_started_at.is_some() && !row.processing)
        {
            SendAttemptStatus::DeliveryUnconfirmed
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
    }))
}

impl EmailSendRepo for EmailPgRepo {
    async fn send_message_row(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> Result<Option<crate::domain::models::MessageRow>, EmailErr> {
        let row = sqlx::query_as!(
            super::db_types::DbMessageRow,
            r#"SELECT id, provider_id, thread_id, provider_thread_id, replying_to_id,
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
        // The message lock serializes edits. Verify the approved attachment set
        // inside admission, never silently send missing or newly added files.
        let uploaded = sqlx::query_scalar!(
            "SELECT id FROM email_attachments_drafts WHERE draft_id = $1 ORDER BY id",
            ids.message_db_id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
        let forwarded = sqlx::query_scalar!("SELECT attachment_id FROM email_attachments_fwd WHERE message_id = $1 ORDER BY attachment_id", ids.message_db_id)
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
        let send_time =
            chrono::Utc::now() + chrono::Duration::seconds(prepared.undo_delay_secs.into());
        sqlx::query!("UPDATE email_scheduled_messages SET send_time = $1 WHERE message_id = $2 AND link_id = $3", send_time, ids.message_db_id, link)
            .execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        let sender = sqlx::query!(
            r#"SELECT l.email_address, COALESCE(m.from_name, c.name) AS name, c.sfs_photo_url
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
        let request = serde_json::to_value(&prepared.snapshot).map_err(anyhow::Error::from)?;
        sqlx::query!(
            r#"INSERT INTO email_send_attempts (user_id, link_id, attempt_id, request, message_id, thread_id, send_time, restore_body_html, restore_body_text, restore_body_macro, prepared_content)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)"#,
            actor.as_ref(), link, attempt.0, request, ids.message_db_id, ids.thread_db_id, send_time,
            prepared.restore_html, prepared.restore_text, prepared.restore_macro,
            prepared_content,
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
                    r#"UPDATE email_messages m SET is_draft = true, body_html_sanitized = a.restore_body_html,
                       body_text = a.restore_body_text, body_macro = a.restore_body_macro, updated_at = NOW()
                       FROM email_send_attempts a WHERE a.user_id = $1 AND a.link_id = $2 AND a.attempt_id = $3
                       AND m.id = a.message_id AND m.link_id = a.link_id AND NOT m.is_sent"#,
                    actor.as_ref(), link, attempt.0,
                ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
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
