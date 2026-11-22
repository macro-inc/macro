use super::*;
use crate::domain::mailbox::imap_notifications::ImapNotificationRepository;
use crate::domain::mailbox::projection::ProjectionEvent;

impl ImapNotificationRepository for PgMailboxSync {
    async fn commit(
        &self,
        mailbox: MailboxKey,
        credentials_rejected: bool,
        revision: Option<i64>,
        mailbox_issue: Option<models_email::service::link::MailboxIssue>,
        retry_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        let current = sqlx::query!(
            r#"
            SELECT
                needs_reauth,
                mailbox_issue,
                mailbox_retry_at,
                imap_notification_revision,
                imap_notification_sync_generation,
                imap_notification_grant_generation
            FROM
                email_links
            WHERE
                id = $1
                AND provider = 'IMAP'
                AND is_sync_active
                AND sync_generation = $2
                AND grant_generation = $3
            FOR NO KEY UPDATE
            "#,
            mailbox.link_id,
            mailbox.sync_generation,
            mailbox.grant_generation,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        // Delayed notifications after reconnect or disconnect are intentionally ignored.
        let Some(current) = current else {
            return Ok(());
        };
        let accepts_health = revision.is_none_or(|incoming| {
            current.imap_notification_sync_generation != Some(mailbox.sync_generation)
                || current.imap_notification_grant_generation != Some(mailbox.grant_generation)
                || current
                    .imap_notification_revision
                    .is_none_or(|seen| incoming >= seen)
        });
        if accepts_health && let Some(revision) = revision {
            sqlx::query!(
                r#"
                UPDATE
                    email_links
                SET
                    imap_notification_revision = $2,
                    imap_notification_sync_generation = $3,
                    imap_notification_grant_generation = $4
                WHERE
                    id = $1
                "#,
                mailbox.link_id,
                revision,
                mailbox.sync_generation,
                mailbox.grant_generation,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        let requires_reconnect = accepts_health
            && (credentials_rejected
                || mailbox_issue
                    == Some(models_email::service::link::MailboxIssue::CredentialsUnreadable));
        if requires_reconnect && !current.needs_reauth {
            sqlx::query!(
                r#"
                UPDATE
                    email_links
                SET
                    needs_reauth = true,
                    last_sync_error_at = CASE
                        WHEN $2 THEN now()
                        ELSE last_sync_error_at
                    END,
                    updated_at = now()
                WHERE
                    id = $1
                "#,
                mailbox.link_id,
                credentials_rejected,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            let event = serde_json::to_value(ProjectionEvent::ReauthorizationRequired)
                .map_err(|_| MailboxError::Persistence)?;
            sqlx::query!(
                r#"
                INSERT INTO email_projection_outbox (id, link_id, generation, payload)
                    VALUES ($1, $2, $3, $4)
                "#,
                macro_uuid::generate_uuid_v7(),
                mailbox.link_id,
                mailbox.sync_generation,
                event,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        let retry_at = mailbox_issue.and(retry_at);
        let issue = mailbox_issue.map(|issue| issue.as_ref().to_owned());
        // PostgreSQL stores microseconds; a repeated nanosecond timestamp must
        // not create another health edge after the database round-trip.
        let retry_changed = current.mailbox_retry_at.map(|at| at.timestamp_micros())
            != retry_at.map(|at| at.timestamp_micros());
        if accepts_health && (current.mailbox_issue != issue || retry_changed) {
            sqlx::query!(
                r#"
                UPDATE
                    email_links
                SET
                    mailbox_issue = $2,
                    mailbox_retry_at = $3,
                    updated_at = now()
                WHERE
                    id = $1
                "#,
                mailbox.link_id,
                issue,
                retry_at,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            let event = serde_json::to_value(ProjectionEvent::LinkChanged)
                .map_err(|_| MailboxError::Persistence)?;
            sqlx::query!(
                r#"
                INSERT INTO email_projection_outbox (id, link_id, generation, payload)
                VALUES ($1, $2, $3, $4)
                "#,
                macro_uuid::generate_uuid_v7(),
                mailbox.link_id,
                mailbox.sync_generation,
                event,
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        if !requires_reconnect {
            sqlx::query!(
                r#"
                UPDATE
                    email_sync_streams
                SET
                    notified_at = clock_timestamp(),
                    notification_revision = notification_revision + 1,
                    notified_traceparent = $3,
                    next_run_at = GREATEST(LEAST(next_run_at, clock_timestamp()), provider_retry_at)
                WHERE
                    link_id = $1
                    AND generation = $2
                    AND kind IN ('folder_catalog', 'mail_folder')
                "#,
                mailbox.link_id,
                mailbox.sync_generation,
                crate::trace_context::current(),
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        tx.commit().await.map_err(db_error)
    }
}
