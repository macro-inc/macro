use super::*;
use crate::domain::mailbox::commands::*;
use crate::domain::models::mailbox_action::{MailboxAction, PendingMailboxState};
use email_api_client::domain::models::MailboxOrganization;

impl PgMailboxSync {
    async fn lock_command(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        lease: &CommandLease,
    ) -> Result<(), MailboxError> {
        let active = sqlx::query!(r#"
            SELECT id FROM email_links WHERE id = $1 AND sync_generation = $2 AND grant_generation = $3
                AND is_sync_active FOR UPDATE
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation).fetch_optional(&mut **tx).await.map_err(db_error)?;
        if active.is_none() {
            return Err(MailboxError::Stale);
        }
        let command = sqlx::query!(
            r#"
            SELECT id FROM email_mailbox_commands WHERE id = $1 AND link_id = $2 AND generation = $3
                AND lease_id = $4 AND lease_until > now() AND status = 'running' FOR UPDATE
        "#,
            lease.id,
            lease.mailbox.link_id,
            lease.mailbox.sync_generation,
            lease.lease_id
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(db_error)?;
        if command.is_none() {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn update_command_projection(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        lease: &CommandLease,
        message_id: Uuid,
    ) -> Result<(), MailboxError> {
        let row = sqlx::query!(r#"
            UPDATE email_messages m SET
                is_read = COALESCE((SELECT (desired #>> '{}')::boolean FROM email_pending_mailbox_state WHERE message_id = m.id AND attribute = 'is_read'),(m.mailbox_state->>'is_read')::boolean,m.is_read),
                is_starred = COALESCE((SELECT (desired #>> '{}')::boolean FROM email_pending_mailbox_state WHERE message_id = m.id AND attribute = 'is_flagged'),(m.mailbox_state->>'is_flagged')::boolean,m.is_starred)
            WHERE m.id = $1 AND m.link_id = $2 RETURNING m.thread_id
        "#,message_id,lease.mailbox.link_id).fetch_optional(&mut **tx).await.map_err(db_error)?;
        if let Some(row) = row {
            email_db_client::threads::update::recompute_thread_metadata(
                tx,
                row.thread_id,
                lease.mailbox.link_id,
            )
            .await
            .map_err(db_error)?;
            let payload = serde_json::json!({"kind":"organization","thread_id":row.thread_id});
            sqlx::query!("INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),lease.mailbox.link_id,lease.mailbox.sync_generation,payload).execute(&mut **tx).await.map_err(db_error)?;
        }
        Ok(())
    }
}

impl MailboxCommandRepository for PgMailboxSync {
    async fn claim_command(&self, lease_id: Uuid) -> Result<Option<CommandLease>, MailboxError> {
        let mut tx = self.mutation_claim_transaction().await?;
        let row = sqlx::query!(r#"
            WITH candidate AS (
                SELECT c.id FROM email_mailbox_commands c JOIN email_links l ON l.id = c.link_id
                WHERE l.is_sync_active AND l.provider = 'OUTLOOK' AND c.generation = l.sync_generation
                    AND c.status IN ('pending','running') AND c.available_at <= now()
                    AND (c.lease_until IS NULL OR c.lease_until < now())
                    AND c.intent->>'kind' IN ('read','flagged','archived','trashed','junk','category')
                    AND (c.intent->>'kind'<>'category' OR NOT EXISTS(SELECT 1 FROM email_mailbox_settings_work s
                        WHERE s.link_id=c.link_id AND s.kind='create_label' AND s.resource_key=c.intent->'value'->>'name'
                        AND s.completed_revision<s.revision))
                    AND NOT EXISTS (SELECT 1 FROM email_mailbox_command_targets target JOIN email_mailbox_drafts draft ON draft.message_id=target.message_id
                        WHERE target.command_id=c.id AND draft.lease_until>now() AND draft.lease_id IS NOT NULL)
                    AND NOT EXISTS (SELECT 1 FROM email_mailbox_commands prior
                        WHERE prior.link_id = c.link_id AND prior.generation = c.generation
                            AND prior.status IN ('pending','running','confirming')
                            AND prior.accepted_order < c.accepted_order
                            AND EXISTS(SELECT 1 FROM email_mailbox_command_targets earlier JOIN email_mailbox_command_targets current
                                ON current.message_id=earlier.message_id WHERE earlier.command_id=prior.id AND current.command_id=c.id))
                ORDER BY c.available_at,c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED
            )
            UPDATE email_mailbox_commands c SET lease_id = $1,lease_until = now() + interval '3 minutes',
                status = 'running',attempts = attempts + 1,updated_at = now()
            FROM candidate q,email_links l WHERE c.id = q.id AND l.id = c.link_id
            RETURNING c.id,c.link_id,c.generation,l.grant_generation,c.intent,c.attempts
        "#,lease_id).fetch_optional(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        row.map(|row| {
            Ok(CommandLease {
                id: row.id,
                lease_id,
                mailbox: MailboxKey {
                    link_id: row.link_id,
                    sync_generation: row.generation,
                    grant_generation: row.grant_generation,
                },
                action: serde_json::from_value(row.intent)
                    .map_err(|_| MailboxError::Persistence)?,
                attempts: row.attempts,
            })
        })
        .transpose()
    }

    async fn renew_command(&self, lease: &CommandLease) -> Result<(), MailboxError> {
        let count = sqlx::query!(r#"
            UPDATE email_mailbox_commands c SET lease_until = now() + interval '3 minutes'
            FROM email_links l WHERE c.id = $1 AND c.lease_id = $2 AND c.lease_until > now() AND c.status = 'running'
                AND l.id = c.link_id AND l.is_sync_active AND l.sync_generation = c.generation AND l.grant_generation = $3
        "#,lease.id,lease.lease_id,lease.mailbox.grant_generation).execute(&self.db).await.map_err(db_error)?.rows_affected();
        if count != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }

    async fn command_context(&self, lease: &CommandLease) -> Result<CommandContext, MailboxError> {
        let row = sqlx::query!(r#"
            SELECT (l.macro_id = c.actor_id OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = l.id AND u.primary_macro_id = c.actor_id)) AS "authorized!",
                EXISTS (SELECT 1 FROM email_mailbox_command_targets t WHERE t.command_id = c.id AND t.status IN ('failed','conflict')) AS "has_errors!"
            FROM email_mailbox_commands c JOIN email_links l ON l.id = c.link_id
            WHERE c.id = $1 AND c.lease_id = $2 AND c.lease_until > now() AND c.status = 'running'
                AND l.is_sync_active AND l.sync_generation = c.generation AND l.grant_generation = $3
        "#,lease.id,lease.lease_id,lease.mailbox.grant_generation).fetch_optional(&self.db).await.map_err(db_error)?.ok_or(MailboxError::Stale)?;
        let target = sqlx::query!(r#"SELECT t.message_id,COALESCE(t.provider_id,m.provider_id) AS provider_id,t.pending,
            COALESCE((d.state IN ('pending','running') AND d.synced_revision=0) OR (m.provider_id IS NULL AND d.state<>'deleted'),false) AS "awaiting_draft!",
            (COALESCE(d.delete_requested,false) OR COALESCE(d.state='deleted',false) OR COALESCE((m.mailbox_state->>'provider_missing')::bool,false)
                OR EXISTS(SELECT 1 FROM email_draft_transfers transfer WHERE transfer.source_id=m.id AND transfer.state<>'preparing')) AS "retired!"
            FROM email_mailbox_command_targets t JOIN email_messages m ON m.id=t.message_id AND m.link_id=$2
            LEFT JOIN email_mailbox_drafts d ON d.message_id=m.id
            WHERE t.command_id=$1 AND t.status='pending' ORDER BY t.message_id LIMIT 1"#,lease.id,lease.mailbox.link_id).fetch_optional(&self.db).await.map_err(db_error)?;
        Ok(CommandContext {
            authorized: row.authorized,
            has_errors: row.has_errors,
            folders: self.folders(lease.mailbox).await?,
            target: target
                .map(|t| {
                    Ok::<_, MailboxError>(CommandTarget {
                        message_id: t.message_id,
                        awaiting_draft: t.awaiting_draft,
                        retired: t.retired,
                        provider_id: t.provider_id.map(ProviderId::new).transpose()?,
                        pending: serde_json::from_value::<PendingMailboxState>(t.pending)
                            .map_err(|_| MailboxError::Persistence)?,
                    })
                })
                .transpose()?,
        })
    }

    async fn defer_for_draft(&self, lease: &CommandLease) -> Result<(), MailboxError> {
        sqlx::query!("UPDATE email_mailbox_commands SET attempts=0,lease_id=NULL,lease_until=NULL,available_at=now()+interval '5 seconds' WHERE id=$1 AND lease_id=$2 AND lease_until>now() AND status='running'",lease.id,lease.lease_id)
            .execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }

    async fn record_write_version(
        &self,
        lease: &CommandLease,
        target: &CommandTarget,
        previous: &str,
        current: &str,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_command(&mut tx, lease).await?;
        sqlx::query!(r#"INSERT INTO email_draft_organization_versions(message_id,versions)
            SELECT m.id,ARRAY[$3::text,$4::text] FROM email_messages m WHERE m.id=$1 AND m.link_id=$2 AND m.is_draft
                AND (m.provider_version=$3 OR EXISTS(SELECT 1 FROM email_draft_organization_versions v
                    WHERE v.message_id=m.id AND v.versions[cardinality(v.versions)]=$3))
                AND NOT EXISTS(SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id=m.id)
            ON CONFLICT(message_id) DO UPDATE SET versions=array_append(email_draft_organization_versions.versions,$4)
                WHERE email_draft_organization_versions.versions[cardinality(email_draft_organization_versions.versions)]=$3"#,
            target.message_id,lease.mailbox.link_id,previous,current).execute(&mut *tx).await.map_err(db_error)?;
        // New local edits may be queued while this organization call is in
        // flight. They inherit the same unchanged provider content baseline.
        sqlx::query!(r#"UPDATE email_mailbox_drafts SET base_version=$4,
            checkpoint=CASE WHEN checkpoint->'draft'->>'version'=$3 THEN jsonb_set(checkpoint,'{draft,version}',to_jsonb($4::text)) ELSE checkpoint END
            WHERE message_id=$1 AND link_id=$2 AND base_version=$3 AND NOT delete_requested
                AND (lease_until IS NULL OR lease_until<now())"#,target.message_id,lease.mailbox.link_id,previous,current).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    async fn confirm_target(
        &self,
        lease: &CommandLease,
        target: &CommandTarget,
        snapshot: Option<&MailboxOrganization>,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_command(&mut tx, lease).await?;
        let retired=sqlx::query_scalar!(r#"SELECT (COALESCE((m.mailbox_state->>'provider_missing')::bool,false)
            OR EXISTS(SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id=m.id AND (d.delete_requested OR d.state='deleted'))
            OR EXISTS(SELECT 1 FROM email_draft_transfers t WHERE t.source_id=m.id AND t.state<>'preparing')) AS "retired!"
            FROM email_messages m WHERE m.id=$1 AND m.link_id=$2 FOR UPDATE"#,target.message_id,lease.mailbox.link_id)
            .fetch_optional(&mut *tx).await.map_err(db_error)?.unwrap_or(true);
        if retired {
            sqlx::query!(
                "DELETE FROM email_pending_mailbox_state WHERE command_id=$1 AND message_id=$2",
                lease.id,
                target.message_id
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            sqlx::query!("UPDATE email_mailbox_command_targets SET status='failed' WHERE command_id=$1 AND message_id=$2",lease.id,target.message_id).execute(&mut *tx).await.map_err(db_error)?;
            Self::update_command_projection(&mut tx, lease, target.message_id).await?;
            return tx.commit().await.map_err(db_error);
        }
        let state = match snapshot {
            Some(snapshot) => serde_json::to_value(&snapshot.state),
            None => serde_json::to_value(&target.pending),
        }
        .map_err(|_| MailboxError::Persistence)?;
        sqlx::query!(
            r#"
            UPDATE email_messages SET mailbox_state = (COALESCE(mailbox_state,'{}'::jsonb) - 'provider_missing') || $3
            WHERE id = $1 AND link_id = $2
        "#,
            target.message_id,
            lease.mailbox.link_id,
            state
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        // Only this command's intent is removed; newer accepted input survives.
        sqlx::query!(
            "DELETE FROM email_pending_mailbox_state WHERE message_id = $1 AND command_id = $2",
            target.message_id,
            lease.id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        if let Some(snapshot) = snapshot {
            sqlx::query!(
                "DELETE FROM email_message_labels WHERE message_id = $1",
                target.message_id
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            for tag in &snapshot.tags {
                let label = sqlx::query_scalar!(r#"
                    INSERT INTO email_labels (id,link_id,provider_label_id,name,type) VALUES ($1,$2,$3::text,$3::text,'User')
                    ON CONFLICT (link_id,provider_label_id) DO UPDATE SET name = EXCLUDED.name RETURNING id
                "#,macro_uuid::generate_uuid_v7(),lease.mailbox.link_id,tag).fetch_one(&mut *tx).await.map_err(db_error)?;
                sqlx::query!("INSERT INTO email_message_labels (message_id,label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",target.message_id,label).execute(&mut *tx).await.map_err(db_error)?;
            }
        } else if let MailboxAction::Category { name, present } = &lease.action {
            if *present {
                sqlx::query!(r#"INSERT INTO email_message_labels (message_id,label_id)
                    SELECT $1,id FROM email_labels WHERE link_id = $2 AND provider_label_id = $3 ON CONFLICT DO NOTHING
                "#,target.message_id,lease.mailbox.link_id,name).execute(&mut *tx).await.map_err(db_error)?;
            } else {
                sqlx::query!("DELETE FROM email_message_labels ml USING email_labels l WHERE ml.message_id = $1 AND ml.label_id = l.id AND l.link_id = $2 AND l.provider_label_id = $3",target.message_id,lease.mailbox.link_id,name).execute(&mut *tx).await.map_err(db_error)?;
            }
        }
        if let Some(id) = &target.provider_id {
            sqlx::query!(r#"
                INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import) VALUES ($1,$2,$3,false)
                ON CONFLICT (link_id,generation,provider_id) DO UPDATE SET revision = email_message_reconciliation.revision + 1,available_at = now(),is_import = false
            "#,lease.mailbox.link_id,lease.mailbox.sync_generation,id.as_str()).execute(&mut *tx).await.map_err(db_error)?;
        }
        sqlx::query!("UPDATE email_mailbox_command_targets SET status = 'succeeded' WHERE command_id = $1 AND message_id = $2",lease.id,target.message_id).execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!(
            "UPDATE email_mailbox_commands SET attempts = 0 WHERE id = $1",
            lease.id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        Self::update_command_projection(&mut tx, lease, target.message_id).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn fail_target(
        &self,
        lease: &CommandLease,
        target: &CommandTarget,
        conflict: bool,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_command(&mut tx, lease).await?;
        sqlx::query!(
            "DELETE FROM email_pending_mailbox_state WHERE command_id = $1 AND message_id = $2",
            lease.id,
            target.message_id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        sqlx::query!("UPDATE email_mailbox_command_targets SET status = $3 WHERE command_id = $1 AND message_id = $2",lease.id,target.message_id,if conflict {"conflict"} else {"failed"}).execute(&mut *tx).await.map_err(db_error)?;
        sqlx::query!(
            "UPDATE email_mailbox_commands SET attempts = 0 WHERE id = $1",
            lease.id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        Self::update_command_projection(&mut tx, lease, target.message_id).await?;
        tx.commit().await.map_err(db_error)
    }

    async fn release_command(
        &self,
        lease: &CommandLease,
        seconds: u32,
    ) -> Result<(), MailboxError> {
        sqlx::query!(r#"
            UPDATE email_mailbox_commands SET lease_id = NULL,lease_until = NULL,
                available_at = now() + make_interval(secs => $3::double precision),updated_at = now()
            WHERE id = $1 AND lease_id = $2 AND lease_until > now() AND status = 'running'
        "#,lease.id,lease.lease_id,f64::from(seconds)).execute(&self.db).await.map_err(db_error)?;
        Ok(())
    }

    async fn finish_command(
        &self,
        lease: &CommandLease,
        completion: CommandCompletion,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        Self::lock_command(&mut tx, lease).await?;
        let messages = sqlx::query_scalar!(
            "DELETE FROM email_pending_mailbox_state WHERE command_id = $1 RETURNING message_id",
            lease.id
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(db_error)?;
        for message in messages {
            Self::update_command_projection(&mut tx, lease, message).await?;
        }
        let status = match completion {
            CommandCompletion::Succeeded => "succeeded",
            CommandCompletion::Failed => "failed",
            CommandCompletion::Cancelled => "cancelled",
        };
        sqlx::query!("UPDATE email_mailbox_commands SET status = $2,lease_id = NULL,lease_until = NULL,updated_at = now() WHERE id = $1",lease.id,status).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }
}

#[cfg(test)]
mod test;
