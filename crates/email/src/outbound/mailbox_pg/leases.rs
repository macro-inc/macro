//! Validate fresh leases without rewriting their indexed expiry.

use super::*;

impl PgMailboxSync {
    async fn stream_lease_fresh(
        &self,
        id: Uuid,
        lease_id: Uuid,
        fence: i64,
        mailbox: MailboxKey,
    ) -> Result<Option<bool>, MailboxError> {
        sqlx::query_scalar!(
            r#"
            SELECT s.lease_until > now() + interval '150 seconds' AS "fresh!"
            FROM email_sync_streams s JOIN email_links l ON l.id = s.link_id
            WHERE s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now() AND l.sync_generation = s.generation
                AND l.grant_generation = $4 AND l.is_sync_active
            "#,
            id,
            lease_id,
            fence,
            mailbox.grant_generation,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(db_error)
    }

    pub(super) async fn renew_stream(
        &self,
        id: Uuid,
        lease_id: Uuid,
        fence: i64,
        mailbox: MailboxKey,
    ) -> Result<u64, MailboxError> {
        match self
            .stream_lease_fresh(id, lease_id, fence, mailbox)
            .await?
        {
            None => return Ok(0),
            Some(true) => return Ok(1),
            Some(false) => {}
        }
        let updated = sqlx::query!(
            r#"
            UPDATE email_sync_streams s SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE s.id = $1 AND s.lease_id = $2 AND s.fence = $3
                AND s.lease_until > now()
                AND s.lease_until <= now() + interval '150 seconds'
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
        if updated > 0 {
            return Ok(updated);
        }
        // An overlapping renewal may already have extended the same lease.
        // Preserve stale detection without forcing another indexed write.
        Ok(u64::from(
            self.stream_lease_fresh(id, lease_id, fence, mailbox)
                .await?
                .is_some(),
        ))
    }

    async fn message_lease_fresh(
        &self,
        lease: &MessageLease,
    ) -> Result<Option<bool>, MailboxError> {
        sqlx::query_scalar!(
            r#"
            SELECT q.lease_until > now() + interval '150 seconds' AS "fresh!"
            FROM email_message_reconciliation q JOIN email_links l ON l.id = q.link_id
            WHERE q.link_id = $1 AND q.generation = $2 AND q.provider_id = $3
                AND q.lease_id = $4 AND q.lease_until > now()
                AND l.sync_generation = q.generation AND l.grant_generation = $5
                AND l.is_sync_active
            "#,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            lease.provider_id.as_str(),
            lease.lease_id,
            lease.mailbox.grant_generation,
        )
        .fetch_optional(&self.db)
        .await
        .map_err(db_error)
    }

    pub(super) async fn renew_message(&self, lease: &MessageLease) -> Result<u64, MailboxError> {
        match self.message_lease_fresh(lease).await? {
            None => return Ok(0),
            Some(true) => return Ok(1),
            Some(false) => {}
        }
        let updated = sqlx::query!(
            r#"
            UPDATE email_message_reconciliation q SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE q.link_id = $1 AND q.generation = $2 AND q.provider_id = $3
                AND q.lease_id = $4 AND q.lease_until > now()
                AND q.lease_until <= now() + interval '150 seconds'
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
        if updated > 0 {
            return Ok(updated);
        }
        Ok(u64::from(self.message_lease_fresh(lease).await?.is_some()))
    }
}
