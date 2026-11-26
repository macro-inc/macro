use super::*;
use crate::domain::mailbox::watches::*;
use chrono::{DateTime, Utc};
use email_api_client::domain::models::MailboxSubscription;

#[cfg(test)]
mod test;

async fn guard(tx: &mut sqlx::PgConnection, lease: &WatchLease) -> Result<(), MailboxError> {
    let valid=sqlx::query!(r#"SELECT w.link_id FROM email_mailbox_watch_work w JOIN email_links l ON l.id=w.link_id
        WHERE w.link_id=$1 AND w.lease_id=$2 AND w.lease_until>now() AND l.sync_generation=$3 AND l.grant_generation=$4 AND l.is_sync_active
        FOR UPDATE OF l,w"#,lease.mailbox.link_id,lease.lease_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation)
        .fetch_optional(tx).await.map_err(db_error)?;
    if valid.is_none() {
        return Err(MailboxError::Stale);
    }
    Ok(())
}
impl PgMailboxSync {
    /// Queues the message a notification names as live work, as a live folder
    /// page would (`is_import` false, the notification's time and trace), and
    /// answers whether it did. A row already queued for it takes the newer
    /// revision, so every change to one message is one row. Nothing is queued
    /// while a folder of the mailbox is still in its import round, where its
    /// folder pages queue import work, or while the mailbox has `queued_ahead`
    /// live messages due: its folders' pages list the rest. The checks read
    /// `email_sync_streams_link_import_rounds` and
    /// `email_message_reconciliation_live_queued`, whose predicates they repeat.
    async fn queue_notified_message(
        tx: &mut sqlx::PgConnection,
        link_id: Uuid,
        generation: i64,
        message: &ProviderId,
        queued_ahead: u32,
    ) -> Result<bool, MailboxError> {
        let queued = sqlx::query!(
            r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,notified_at,notified_traceparent,from_notification)
            SELECT $1,$2,$3,false,clock_timestamp(),$4,true
            WHERE NOT EXISTS (
                SELECT 1 FROM email_sync_streams s
                WHERE s.link_id = $1 AND s.generation = $2 AND s.kind = 'mail_folder' AND NOT s.initial_complete
            ) AND (
                SELECT count(*) FROM (
                    SELECT 1 FROM email_message_reconciliation q
                    WHERE q.link_id = $1 AND q.generation = $2 AND NOT q.is_import AND q.available_at <> 'infinity'
                        AND q.available_at <= now()
                    LIMIT $5
                ) due
            ) < $5
            ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET
                revision = email_message_reconciliation.revision + 1,
                is_import = false,
                notified_at = EXCLUDED.notified_at,
                notified_traceparent = EXCLUDED.notified_traceparent,
                available_at = now()
        "#,
            link_id,
            generation,
            message.as_str(),
            crate::trace_context::current(),
            i64::from(queued_ahead)
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        Ok(queued.rows_affected() == 1)
    }
}

impl MailboxWatchRepository for PgMailboxSync {
    async fn claim_watch(&self, lease_id: Uuid) -> Result<Option<WatchLease>, MailboxError> {
        let row=sqlx::query!(r#"WITH candidate AS(SELECT w.link_id FROM email_mailbox_watch_work w JOIN email_links l ON l.id=w.link_id
            WHERE l.is_sync_active AND l.mailbox_unavailable_at IS NULL AND l.provider='OUTLOOK' AND w.next_run_at<=now() AND (w.lease_until IS NULL OR w.lease_until<now())
            ORDER BY w.next_run_at LIMIT 1 FOR UPDATE OF w SKIP LOCKED)
            UPDATE email_mailbox_watch_work w SET lease_id=$1,lease_until=now()+interval '3 minutes'
            FROM candidate c,email_links l WHERE w.link_id=c.link_id AND l.id=w.link_id
            RETURNING w.link_id,w.revision,w.failures,l.sync_generation,l.grant_generation"#,lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
        Ok(row.map(|r| WatchLease {
            lease_id,
            revision: r.revision,
            failures: r.failures,
            mailbox: MailboxKey {
                link_id: r.link_id,
                sync_generation: r.sync_generation,
                grant_generation: r.grant_generation,
            },
        }))
    }
    async fn renew_watch_lease(&self, lease: &WatchLease) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        sqlx::query!("UPDATE email_mailbox_watch_work SET lease_until=now()+interval '3 minutes' WHERE link_id=$1",lease.mailbox.link_id)
            .execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }
    async fn watch_attempts(&self, lease: &WatchLease) -> Result<Vec<WatchAttempt>, MailboxError> {
        let rows=sqlx::query!("SELECT id,generation,provider_id,client_state_hash,expires_at FROM email_provider_subscriptions WHERE link_id=$1 ORDER BY generation DESC,expires_at DESC",lease.mailbox.link_id)
            .fetch_all(&self.db).await.map_err(db_error)?;
        rows.into_iter()
            .map(|r| {
                Ok(WatchAttempt {
                    id: r.id,
                    generation: r.generation,
                    provider_id: r.provider_id.map(ProviderId::new).transpose()?,
                    verifier: r.client_state_hash,
                    expires_at: r.expires_at,
                })
            })
            .collect()
    }
    async fn reserve_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
        verifier: &[u8],
        expires: DateTime<Utc>,
    ) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        sqlx::query!("INSERT INTO email_provider_subscriptions(id,link_id,generation,client_state_hash,expires_at) VALUES($1,$2,$3,$4,$5)",id,lease.mailbox.link_id,lease.mailbox.sync_generation,verifier,expires)
            .execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }
    async fn bind_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
        subscription: &MailboxSubscription,
    ) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        let updated=sqlx::query!("UPDATE email_provider_subscriptions SET provider_id=$3,expires_at=$4 WHERE id=$1 AND link_id=$2 AND (provider_id IS NULL OR provider_id=$3)",id,lease.mailbox.link_id,subscription.id.as_str(),subscription.expires_at)
            .execute(&mut *tx).await.map_err(db_error)?;
        if updated.rows_affected() != 1 {
            return Err(MailboxError::Stale);
        }
        tx.commit().await.map_err(db_error)
    }
    async fn forget_watch(&self, lease: &WatchLease, id: Uuid) -> Result<(), MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        sqlx::query!(
            "DELETE FROM email_provider_subscriptions WHERE id=$1 AND link_id=$2",
            id,
            lease.mailbox.link_id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }
    async fn release_watch(
        &self,
        lease: &WatchLease,
        delay: u32,
        failures: i32,
    ) -> Result<(), MailboxError> {
        sqlx::query!("UPDATE email_mailbox_watch_work SET lease_id=NULL,lease_until=NULL,next_run_at=CASE WHEN revision=$3 THEN now()+make_interval(secs=>$4) ELSE now() END,failures=CASE WHEN revision=$3 THEN $5 ELSE 0 END WHERE link_id=$1 AND lease_id=$2",lease.mailbox.link_id,lease.lease_id,lease.revision,f64::from(delay),failures)
            .execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }
    async fn notification_binding(&self, id: Uuid) -> Result<Option<WatchAttempt>, MailboxError> {
        let row=sqlx::query!(r#"SELECT s.id,s.generation,s.provider_id,s.client_state_hash,s.expires_at FROM email_provider_subscriptions s
            JOIN email_links l ON l.id=s.link_id WHERE s.id=$1 AND l.is_sync_active AND s.generation=l.sync_generation AND s.expires_at>now()"#,id)
            .fetch_optional(&self.db).await.map_err(db_error)?;
        row.map(|r| {
            Ok(WatchAttempt {
                id: r.id,
                generation: r.generation,
                provider_id: r.provider_id.map(ProviderId::new).transpose()?,
                verifier: r.client_state_hash,
                expires_at: r.expires_at,
            })
        })
        .transpose()
    }
    async fn accept_notification(
        &self,
        id: Uuid,
        expected: &WatchAttempt,
        subscription: &str,
        hint: &WatchHint,
        message: Option<&ProviderId>,
        queued_ahead: u32,
    ) -> Result<Option<NotificationAccepted>, MailboxError> {
        let mut tx = self.begin().await.map_err(db_error)?;
        let Some(binding)=sqlx::query!(r#"SELECT s.link_id,l.sync_generation FROM email_provider_subscriptions s JOIN email_links l ON l.id=s.link_id
            WHERE s.id=$1 AND s.generation=$2 AND s.client_state_hash=$3 AND l.is_sync_active AND l.sync_generation=s.generation
            AND (s.provider_id IS NULL OR s.provider_id=$4) FOR UPDATE OF l,s"#,id,expected.generation,&expected.verifier,subscription)
            .fetch_optional(&mut *tx).await.map_err(db_error)? else {return Ok(None);};
        sqlx::query!("UPDATE email_provider_subscriptions SET provider_id=$2 WHERE id=$1 AND provider_id IS NULL",id,subscription)
            .execute(&mut *tx).await.map_err(db_error)?;
        // The webhook's trace context rides with the wakeup, so the sync work
        // it makes due joins the webhook's trace. A live pass is woken too:
        // it is what stores new mail while its folder imports. A stream already
        // due keeps its place: claims take the longest-due first, so moving it
        // to now would put it behind every stream that came due since, and a
        // mailbox notified more often than that line moves would never be read.
        sqlx::query!(
            r#"
            UPDATE
                email_sync_streams
            SET
                notified_at=clock_timestamp(),
                notified_traceparent=$3,
                next_run_at=GREATEST(LEAST(next_run_at,now()),provider_retry_at)
            WHERE
                link_id=$1 AND generation=$2 AND kind IN ('folder_catalog','mail_folder','mail_folder_live')
            "#,
            binding.link_id,
            binding.sync_generation,
            crate::trace_context::current(),
        )
            .execute(&mut *tx).await.map_err(db_error)?;
        if matches!(hint, WatchHint::Removed | WatchHint::Reauthorize) {
            sqlx::query!("UPDATE email_mailbox_watch_work SET next_run_at=now(),revision=revision+1,failures=0 WHERE link_id=$1",binding.link_id)
                .execute(&mut *tx).await.map_err(db_error)?;
        }
        let message_queued = match message {
            Some(message) => {
                Self::queue_notified_message(
                    &mut tx,
                    binding.link_id,
                    binding.sync_generation,
                    message,
                    queued_ahead,
                )
                .await?
            }
            None => false,
        };
        tx.commit().await.map_err(db_error)?;
        Ok(Some(NotificationAccepted {
            link_id: binding.link_id,
            message_queued,
        }))
    }
}
