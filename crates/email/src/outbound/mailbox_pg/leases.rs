//! Fenced lease renewal for synchronization streams and message reads.

use super::*;

impl PgMailboxSync {
    pub(super) async fn renew_stream(
        &self,
        id: Uuid,
        lease_id: Uuid,
        fence: i64,
        mailbox: MailboxKey,
    ) -> Result<u64, MailboxError> {
        let updated = sqlx::query!(
            r#"
            UPDATE email_sync_streams s SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now()
                AND l.id = s.link_id AND l.sync_generation = s.generation
                AND l.grant_generation = $4 AND l.is_sync_active
            "#,
            id,
            lease_id,
            fence,
            mailbox.grant_generation,
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?
        .rows_affected();
        Ok(updated)
    }

    pub(super) async fn renew_message(&self, lease: &MessageLease) -> Result<u64, MailboxError> {
        let updated = sqlx::query!(
            r#"
            UPDATE email_message_reconciliation q SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE q.link_id = $1 AND q.generation = $2 AND q.provider_id = $3
                AND q.lease_id = $4 AND q.lease_until > now()
                AND l.id = q.link_id AND l.sync_generation = q.generation
                AND l.grant_generation = $5 AND l.is_sync_active
            "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            lease.provider_id.as_str(),
            lease.lease_id,
            lease.mailbox.grant_generation,
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?
        .rows_affected();
        Ok(updated)
    }
    pub(super) async fn release_sync_stream(
        &self,
        id: Uuid,
        lease_id: Uuid,
        fence: i64,
        retry: SyncRetry,
    ) -> Result<(), MailboxError> {
        sqlx::query!(
            r#"
            UPDATE
                email_sync_streams
            SET
                lease_id = NULL,
                lease_until = NULL,
                provider_retry_at = CASE
                    WHEN provider = 'IMAP' AND $5 THEN GREATEST(provider_retry_at, now() + make_interval(secs => $4))
                    ELSE provider_retry_at
                END,
                next_run_at = CASE
                    WHEN provider = 'IMAP' THEN GREATEST(
                        CASE
                            WHEN NOT $5 AND notification_revision > leased_notification_revision THEN clock_timestamp()
                            ELSE now() + make_interval(secs => $4)
                        END,
                        provider_retry_at
                    )
                    ELSE now() + make_interval(secs => $4)
                END
            WHERE
                id = $1
                AND lease_id = $2
                AND fence = $3
            "#,
            id,
            lease_id,
            fence,
            f64::from(retry.seconds()),
            retry.is_provider(),
        )
        .execute(&self.db)
        .await
        .map_err(db_error)?;
        Ok(())
    }
}
