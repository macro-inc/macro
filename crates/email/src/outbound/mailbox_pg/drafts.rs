use super::*;
use crate::domain::mailbox::drafts::{models::*, ports::DraftRepository};
use email_api_client::domain::models::ProviderDraft;
use sqlx::{Postgres, Transaction};

#[cfg(test)]
mod test;

impl PgMailboxSync {
    async fn lock_draft(
        tx: &mut Transaction<'_, Postgres>,
        lease: &DraftLease,
    ) -> Result<(), MailboxError> {
        let link = sqlx::query!("SELECT id FROM email_links WHERE id = $1 AND sync_generation = $2 AND grant_generation = $3 AND is_sync_active FOR UPDATE",lease.mailbox.link_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation).fetch_optional(&mut **tx).await.map_err(db_error)?;
        if link.is_none() {
            return Err(MailboxError::Stale);
        }
        sqlx::query!(
            "SELECT id FROM email_messages WHERE id = $1 AND link_id = $2 FOR UPDATE",
            lease.message_id,
            lease.mailbox.link_id
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_error)?;
        let row = sqlx::query!("SELECT message_id FROM email_mailbox_drafts WHERE message_id = $1 AND generation = $2 AND lease_id = $3 AND lease_until > now() AND state = 'running' FOR UPDATE",lease.message_id,lease.mailbox.sync_generation,lease.lease_id).fetch_optional(&mut **tx).await.map_err(db_error)?;
        if row.is_none() {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn bind_draft(
        tx: &mut Transaction<'_, Postgres>,
        lease: &DraftLease,
        draft: &ProviderDraft,
    ) -> Result<(), MailboxError> {
        let updated = sqlx::query!(
            r#"
            UPDATE email_messages SET provider_id = $3,provider_thread_id = $4
            WHERE id = $1 AND link_id = $2 AND (provider_id IS NULL OR provider_id = $3)
        "#,
            lease.message_id,
            lease.mailbox.link_id,
            draft.id.as_str(),
            draft.conversation_id.as_str()
        )
        .execute(&mut **tx)
        .await
        .map_err(db_error)?
        .rows_affected();
        if updated != 1 {
            return Err(MailboxError::Stale);
        }
        // A locally composed thread gains a provider conversation once. Existing
        // Macro thread identity (and its sharing) survives provider draft creation.
        sqlx::query!(r#"
            UPDATE email_threads t SET provider_id = $3
            WHERE t.id = (SELECT thread_id FROM email_messages WHERE id = $1 AND link_id = $2)
                AND t.provider_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM email_threads other WHERE other.link_id = $2 AND other.provider_id = $3 AND other.id <> t.id)
        "#,lease.message_id,lease.mailbox.link_id,draft.conversation_id.as_str()).execute(&mut **tx).await.map_err(db_error)?;
        sqlx::query!(
            "UPDATE email_mailbox_drafts SET provider_id = $2 WHERE message_id = $1",
            lease.message_id,
            draft.id.as_str()
        )
        .execute(&mut **tx)
        .await
        .map_err(db_error)?;
        Ok(())
    }

    async fn draft_projection(
        tx: &mut Transaction<'_, Postgres>,
        lease: &DraftLease,
    ) -> Result<(), MailboxError> {
        let thread = sqlx::query_scalar!(
            "SELECT thread_id FROM email_messages WHERE id = $1",
            lease.message_id
        )
        .fetch_one(&mut **tx)
        .await
        .map_err(db_error)?;
        email_db_client::threads::update::recompute_thread_metadata(
            tx,
            thread,
            lease.mailbox.link_id,
        )
        .await
        .map_err(db_error)?;
        let payload = serde_json::json!({"kind":"organization","thread_id":thread});
        sqlx::query!("INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),lease.mailbox.link_id,lease.mailbox.sync_generation,payload).execute(&mut **tx).await.map_err(db_error)?;
        Ok(())
    }
}

impl DraftRepository for PgMailboxSync {
    async fn claim_draft(
        &self,
        lease_id: Uuid,
        mode: DraftClaimMode,
    ) -> Result<Option<DraftLease>, MailboxError> {
        let mut tx = self.mutation_claim_transaction().await?;
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT d.message_id FROM email_mailbox_drafts d JOIN email_links l ON l.id = d.link_id
                WHERE l.is_sync_active AND l.provider = 'OUTLOOK' AND l.sync_generation = d.generation
                    AND (d.state IN ('pending','running') OR (d.state = 'synced' AND EXISTS (
                        SELECT 1 FROM email_scheduled_messages s WHERE s.message_id = d.message_id AND s.link_id = d.link_id
                            AND NOT s.sent AND NOT s.processing AND s.send_time <= now())))
                    AND ($2 OR d.checkpoint->>'stage' IN ('creating','submitting','confirming'))
                    AND NOT EXISTS(SELECT 1 FROM email_mailbox_command_targets target JOIN email_mailbox_commands command ON command.id=target.command_id
                        WHERE target.message_id=d.message_id AND command.lease_id IS NOT NULL AND command.lease_until>now())
                    AND d.available_at <= now() AND (d.lease_until IS NULL OR d.lease_until < now())
                ORDER BY d.available_at,d.message_id LIMIT 1 FOR UPDATE OF d SKIP LOCKED
            )
            UPDATE email_mailbox_drafts d SET claimed_content = d.desired_content,state = 'running', lease_id = $1,lease_until = now() + interval '3 minutes',updated_at = now()
            FROM candidate c,email_links l WHERE c.message_id = d.message_id AND l.id = d.link_id
            RETURNING d.message_id,d.link_id,d.generation,l.grant_generation,d.revision,d.actor_id,d.desired_content,
                d.provider_id,d.base_version,d.delete_requested,d.checkpoint
        "#,lease_id,mode==DraftClaimMode::All).fetch_optional(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        row.map(|row| {
            Ok(DraftLease {
                message_id: row.message_id,
                lease_id,
                mailbox: MailboxKey {
                    link_id: row.link_id,
                    sync_generation: row.generation,
                    grant_generation: row.grant_generation,
                },
                revision: row.revision,
                actor_id: row.actor_id,
                attachments: row
                    .desired_content
                    .get("_attachments")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(|_| MailboxError::Persistence)?
                    .unwrap_or_default(),
                input: serde_json::from_value(row.desired_content)
                    .map_err(|_| MailboxError::Persistence)?,
                provider_id: row.provider_id.map(ProviderId::new).transpose()?,
                base_version: row.base_version,
                delete_requested: row.delete_requested,
                checkpoint: row
                    .checkpoint
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(|_| MailboxError::Persistence)?,
            })
        })
        .transpose()
    }

    async fn renew_draft(&self, lease: &DraftLease) -> Result<(), MailboxError> {
        let changed = sqlx::query!(r#"
            UPDATE email_mailbox_drafts d SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE d.message_id = $1 AND d.lease_id = $2 AND d.lease_until > now() AND d.state = 'running'
                AND l.id = d.link_id AND l.sync_generation = d.generation AND l.grant_generation = $3 AND l.is_sync_active
        "#,lease.message_id,lease.lease_id,lease.mailbox.grant_generation).execute(&self.db).await.map_err(db_error)?.rows_affected();
        if changed != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn draft_authorized(
        &self,
        lease: &DraftLease,
        actor: &str,
    ) -> Result<bool, MailboxError> {
        sqlx::query_scalar!(r#"
            SELECT (l.macro_id = $4 OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = l.id AND u.primary_macro_id = $4)) AS "authorized!"
            FROM email_mailbox_drafts d JOIN email_links l ON l.id = d.link_id
            WHERE d.message_id = $1 AND d.lease_id = $2 AND d.lease_until > now() AND d.state = 'running'
                AND l.is_sync_active AND l.sync_generation = d.generation AND l.grant_generation = $3
        "#,lease.message_id,lease.lease_id,lease.mailbox.grant_generation,actor).fetch_optional(&self.db).await.map_err(db_error)?.ok_or(MailboxError::Stale)
    }

    async fn checkpoint_draft(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_draft(&mut tx, lease).await?;
        if let Some(draft) = &checkpoint.draft {
            Self::bind_draft(&mut tx, lease, draft).await?;
        }
        let value = serde_json::to_value(checkpoint).map_err(|_| MailboxError::Persistence)?;
        sqlx::query!("UPDATE email_mailbox_drafts SET checkpoint = $2,updated_at = now() WHERE message_id = $1",lease.message_id,value).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    async fn release_draft(&self, lease: &DraftLease, seconds: u32) -> Result<(), MailboxError> {
        let changed = sqlx::query!(r#"
            UPDATE email_mailbox_drafts SET lease_id = NULL,lease_until = NULL,available_at = now() + make_interval(secs => $3::double precision)
            WHERE message_id = $1 AND lease_id = $2 AND lease_until > now() AND state = 'running'
        "#,lease.message_id,lease.lease_id,f64::from(seconds)).execute(&self.db).await.map_err(db_error)?.rows_affected();
        if changed != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn fail_draft(
        &self,
        lease: &DraftLease,
        failure: DraftFailure,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_draft(&mut tx, lease).await?;
        sqlx::query!("UPDATE email_mailbox_drafts SET state = $2,error_code = $3,lease_id = NULL,lease_until = NULL,updated_at = now() WHERE message_id = $1",lease.message_id,failure.state(),failure.code()).execute(&mut *tx).await.map_err(db_error)?;
        if matches!(failure, DraftFailure::Invalid) {
            // A deterministic save rejection never submitted the message. Let
            // the user correct it without leaving a committed schedule behind.
            sqlx::query!("DELETE FROM email_scheduled_messages WHERE message_id=$1 AND NOT processing AND NOT sent",lease.message_id).execute(&mut *tx).await.map_err(db_error)?;
            sqlx::query!(
                "UPDATE email_messages SET is_draft=true WHERE id=$1 AND NOT is_sent",
                lease.message_id
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        if matches!(failure, DraftFailure::SendRejected) {
            sqlx::query!("UPDATE email_scheduled_messages SET processing = false,updated_at = now() WHERE message_id = $1 AND NOT sent",lease.message_id).execute(&mut *tx).await.map_err(db_error)?;
            sqlx::query!("UPDATE email_mailbox_drafts SET checkpoint = checkpoint || '{\"stage\":\"ready\",\"submission_started\":false}'::jsonb WHERE message_id = $1",lease.message_id).execute(&mut *tx).await.map_err(db_error)?;
        }
        sqlx::query!(r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,revision,is_import)
            SELECT link_id,generation,provider_id,1,false FROM email_mailbox_drafts WHERE message_id = $1 AND provider_id IS NOT NULL
            ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET revision = email_message_reconciliation.revision + 1,available_at = now()
        "#,lease.message_id).execute(&mut *tx).await.map_err(db_error)?;
        Self::draft_projection(&mut tx, lease).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn settle_draft(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_draft(&mut tx, lease).await?;
        let draft = checkpoint.draft.as_ref().ok_or(MailboxError::Persistence)?;
        Self::bind_draft(&mut tx, lease, draft).await?;
        let value = serde_json::to_value(checkpoint).map_err(|_| MailboxError::Persistence)?;
        sqlx::query!(r#"
            UPDATE email_mailbox_drafts SET synced_revision = $2,base_version = $3,
                state = CASE WHEN revision = $2 AND NOT delete_requested THEN 'synced' ELSE 'pending' END,
                checkpoint = CASE WHEN revision = $2 THEN $4::jsonb ELSE NULL END,
                error_code = NULL,lease_id = NULL,lease_until = NULL,available_at = now(),updated_at = now()
            WHERE message_id = $1
        "#,lease.message_id,checkpoint.revision,draft.version,value).execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!(r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,revision,is_import)
            VALUES ($1,$2,$3,1,false) ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET
                revision = email_message_reconciliation.revision + 1,available_at = now()
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,draft.id.as_str()).execute(&mut *tx).await.map_err(db_error)?;
        Self::draft_projection(&mut tx, lease).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn start_delivery(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> Result<DeliveryStart, MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_draft(&mut tx, lease).await?;
        let state = sqlx::query!(r#"
            SELECT d.revision,d.delete_requested,m.is_sent,f.in_trash,
                (l.macro_id = $2 OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = l.id AND u.primary_macro_id = $2)) AS "authorized!"
            FROM email_mailbox_drafts d JOIN email_messages m ON m.id = d.message_id
                JOIN email_message_mailbox_facts f ON f.id = m.id JOIN email_links l ON l.id = d.link_id
            WHERE d.message_id = $1
        "#,lease.message_id,checkpoint.actor_id).fetch_one(&mut *tx).await.map_err(db_error)?;
        if !state.authorized || state.delete_requested || state.in_trash.unwrap_or(false) {
            return Ok(DeliveryStart::Denied);
        }
        if state.revision != checkpoint.revision || state.is_sent {
            return Ok(DeliveryStart::NotDue);
        }
        let blocked=sqlx::query_scalar!(r#"SELECT (EXISTS(SELECT 1 FROM email_attachments_drafts WHERE draft_id=$1 AND upload_pending)
            OR EXISTS(SELECT 1 FROM email_draft_transfers WHERE (destination_id=$1 AND state NOT IN ('ready','retained','preparing')) OR (source_id=$1 AND state<>'preparing'))) AS "blocked!""#,lease.message_id).fetch_one(&mut *tx).await.map_err(db_error)?;
        if blocked {
            return Ok(DeliveryStart::Denied);
        }
        let schedule = sqlx::query!(r#"
            UPDATE email_scheduled_messages SET processing = true,updated_at = now()
            WHERE message_id = $1 AND link_id = $2 AND NOT sent AND NOT processing AND send_time <= now()
                AND (actor_id = $3 OR actor_id IS NULL) RETURNING message_id
        "#,lease.message_id,lease.mailbox.link_id,checkpoint.actor_id).fetch_optional(&mut *tx).await.map_err(db_error)?;
        if schedule.is_none() {
            return Ok(DeliveryStart::NotDue);
        }
        let value = serde_json::to_value(checkpoint).map_err(|_| MailboxError::Persistence)?;
        sqlx::query!("UPDATE email_mailbox_drafts SET checkpoint = $2,updated_at = now() WHERE message_id = $1",lease.message_id,value).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        Ok(DeliveryStart::Started)
    }

    async fn confirm_sent(
        &self,
        lease: &DraftLease,
        checkpoint: &DraftCheckpoint,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_draft(&mut tx, lease).await?;
        let draft = checkpoint.draft.as_ref().ok_or(MailboxError::Persistence)?;
        if draft.is_draft {
            return Err(MailboxError::Stale);
        }
        Self::bind_draft(&mut tx, lease, draft).await?;
        let message = sqlx::query!(r#"
            UPDATE email_messages SET is_draft = false,is_sent = true,
                mailbox_state = (COALESCE(mailbox_state,'{}'::jsonb) - 'provider_missing') || '{"is_draft":false}'::jsonb,
                sent_at = now(),updated_at = now()
            WHERE id = $1 RETURNING thread_id
        "#,lease.message_id).fetch_one(&mut *tx).await.map_err(db_error)?;
        sqlx::query!("UPDATE email_scheduled_messages SET sent = true,processing = false,updated_at = now() WHERE message_id = $1 AND link_id = $2",lease.message_id,lease.mailbox.link_id).execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!("UPDATE email_mailbox_drafts SET state = 'sent',base_version = $2,error_code = NULL,lease_id = NULL,lease_until = NULL,updated_at = now() WHERE message_id = $1",lease.message_id,draft.version).execute(&mut *tx).await.map_err(db_error)?;
        let payload = serde_json::json!({"kind":"message","message_id":lease.message_id,"thread_id":message.thread_id,"provider_id":draft.id.as_str(),"is_import":false,"is_new":false,"is_new_thread":false,"was_draft":true,"is_draft":false,"is_sent":true,"version":draft.version,"calendar_parts":[],"actor":checkpoint.submission_started.then_some(&checkpoint.actor_id)});
        let dedupe = format!("send/{}/{}", lease.mailbox.link_id, lease.message_id);
        sqlx::query!("INSERT INTO email_projection_outbox (id,link_id,generation,payload,dedupe_key) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (dedupe_key) DO NOTHING",macro_uuid::generate_uuid_v7(),lease.mailbox.link_id,lease.mailbox.sync_generation,payload,dedupe).execute(&mut *tx).await.map_err(db_error)?;
        // Reconcile attachments and the provider's authoritative sent timestamp.
        sqlx::query!(r#"
            INSERT INTO email_message_reconciliation (link_id,generation,provider_id,revision,is_import)
            VALUES ($1,$2,$3,1,false) ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET
                revision = email_message_reconciliation.revision + 1,available_at = now()
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,draft.id.as_str()).execute(&mut *tx).await.map_err(db_error)?;
        Self::draft_projection(&mut tx, lease).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn confirm_deleted(&self, lease: &DraftLease) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_draft(&mut tx, lease).await?;
        // Release upload metadata only after remote deletion is confirmed. Queued
        // object cleanup still respects other drafts and frozen revisions.
        sqlx::query!(
            "DELETE FROM email_attachments_drafts WHERE draft_id = $1",
            lease.message_id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        // Retain the tombstone so a delayed stream page cannot resurrect the draft.
        sqlx::query!("UPDATE email_messages SET mailbox_state = COALESCE(mailbox_state,'{}'::jsonb) || '{\"provider_missing\":true}'::jsonb WHERE id = $1",lease.message_id).execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!("UPDATE email_mailbox_drafts SET state = 'deleted',lease_id = NULL,lease_until = NULL,updated_at = now() WHERE message_id = $1",lease.message_id).execute(&mut *tx).await.map_err(db_error)?;
        Self::draft_projection(&mut tx, lease).await?;
        tx.commit().await.map_err(db_error)
    }
}
