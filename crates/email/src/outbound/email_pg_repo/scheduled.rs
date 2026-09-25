use super::EmailPgRepo;
use crate::domain::{
    models::EmailErr,
    scheduled::{EmailSchedulingRepo, ScheduleChange, SignaturePreparation},
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

impl EmailSchedulingRepo for EmailPgRepo {
    async fn change_schedule(
        &self,
        link_id: Uuid,
        message_id: Uuid,
        actor: &MacroUserIdStr<'_>,
        change: ScheduleChange,
        signature: Option<&SignaturePreparation>,
    ) -> Result<Option<Uuid>, EmailErr> {
        change_schedule(&self.pool, link_id, message_id, actor, change, signature).await
    }
}

async fn change_schedule(
    pool: &sqlx::PgPool,
    link_id: Uuid,
    message_id: Uuid,
    actor: &MacroUserIdStr<'_>,
    change: ScheduleChange,
    signature: Option<&SignaturePreparation>,
) -> Result<Option<Uuid>, EmailErr> {
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    // Every mutator locks message before schedule; no locks cross provider work.
    let message = sqlx::query!(
        "SELECT thread_id, is_draft, is_sent, replying_to_id, body_html_sanitized, body_text FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
        message_id, link_id,
    ).fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?
        .ok_or(EmailErr::MessageNotFound(message_id))?;
    let schedule = sqlx::query!(
        "SELECT sent, processing FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2 FOR UPDATE",
        message_id, link_id,
    ).fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?;
    if message.is_sent
        || schedule
            .as_ref()
            .is_some_and(|row| row.sent || row.processing)
    {
        return Err(EmailErr::MessageDeliveryConflict(message_id));
    }
    match change {
        ScheduleChange::Set(send_time) => {
            if !message.is_draft {
                return Err(EmailErr::MessageDeliveryConflict(message_id));
            }
            // Check again after acquiring locks so a delayed request cannot
            // commit a time that expired while waiting for another transaction.
            crate::domain::scheduled::validate_schedule_change(change, chrono::Utc::now())?;
            // A confirmed time-only update must preserve the committed payload.
            if schedule.is_none()
                && let Some(signature) = signature
            {
                let mut html = message.body_html_sanitized;
                let mut text = message.body_text;
                signature.apply(message.replying_to_id.is_some(), &mut html, &mut text);
                sqlx::query!(
                    "UPDATE email_messages SET body_html_sanitized = $1, body_text = $2, updated_at = NOW() WHERE id = $3 AND link_id = $4",
                    html, text, message_id, link_id,
                ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
            }
            let updated = sqlx::query!(
                r#"INSERT INTO email_scheduled_messages
                    (link_id, message_id, send_time, sent, processing, actor_id, created_at, updated_at)
                   VALUES ($1, $2, $3, false, false, $4, NOW(), NOW())
                   ON CONFLICT (link_id, message_id) DO UPDATE SET
                    send_time = EXCLUDED.send_time, actor_id = EXCLUDED.actor_id, updated_at = NOW()
                   WHERE NOT email_scheduled_messages.sent AND NOT email_scheduled_messages.processing"#,
                link_id, message_id, send_time, actor.as_ref(),
            ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
            if updated.rows_affected() != 1 {
                return Err(EmailErr::MessageDeliveryConflict(message_id));
            }
        }
        ScheduleChange::Cancel => {
            if schedule.is_none() {
                return if message.is_draft {
                    Ok(None)
                } else {
                    Err(EmailErr::MessageDeliveryConflict(message_id))
                };
            }
            let deleted = sqlx::query!(
                "DELETE FROM email_scheduled_messages WHERE link_id = $1 AND message_id = $2 AND NOT sent AND NOT processing",
                link_id, message_id,
            ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
            if deleted.rows_affected() != 1 {
                return Err(EmailErr::MessageDeliveryConflict(message_id));
            }
            sqlx::query!(
                "UPDATE email_messages SET is_draft = true, updated_at = NOW() WHERE id = $1 AND link_id = $2 AND NOT is_sent",
                message_id, link_id,
            ).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
        }
    }
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Some(message.thread_id))
}
