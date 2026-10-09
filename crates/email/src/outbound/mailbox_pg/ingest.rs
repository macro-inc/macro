use super::*;
use crate::domain::mailbox::drafts::models::DraftCheckpoint;
use email_api_client::domain::models::MailboxMessage;

impl MailboxIngest for PgMailboxSync {
    async fn ingest(
        &self,
        lease: &MessageLease,
        snapshot: MailboxMessage,
    ) -> Result<(), MailboxError> {
        let MailboxMessage {
            draft_correlation,
            content,
            state,
            folder_id,
            tags,
            version,
        } = snapshot;
        let mut message = content.message;
        if message.link_id != lease.mailbox.link_id
            || message.provider_id.as_deref() != Some(lease.provider_id.as_str())
        {
            return Err(MailboxError::Stale);
        }
        let thread_provider_id = message
            .provider_thread_id
            .as_ref()
            .ok_or(MailboxError::Persistence)?;
        let addresses = email_db_client::parse::service_to_db::addresses_from_message(&message);
        let recipients =
            email_db_client::contacts::upsert_message::parse_and_upsert_message_contacts(
                &self.db,
                lease.mailbox.link_id,
                addresses,
            )
            .await
            .map_err(|_| MailboxError::Persistence)?;
        let mut tx = self.db.begin().await.map_err(db_error)?;
        let active = sqlx::query!(r#"
            SELECT id FROM email_links WHERE id = $1 AND sync_generation = $2 AND grant_generation = $3
                AND is_sync_active FOR UPDATE
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation)
            .fetch_optional(&mut *tx).await.map_err(db_error)?;
        if active.is_none() {
            return Err(MailboxError::Stale);
        }
        let work = sqlx::query!(r#"
            SELECT revision FROM email_message_reconciliation
            WHERE link_id = $1 AND generation = $2 AND provider_id = $3 AND lease_id = $4 AND lease_until > now()
            FOR UPDATE
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id)
            .fetch_optional(&mut *tx).await.map_err(db_error)?;
        if work.is_none() {
            return Err(MailboxError::Stale);
        }
        if let Some(correlation) = draft_correlation {
            // A notification can arrive before the creation response. Bind only a
            // server-minted draft that has a durable creation attempt in this mailbox.
            sqlx::query!(r#"
                UPDATE email_messages m SET provider_id = $3,provider_thread_id = $4
                FROM email_mailbox_drafts d WHERE m.id = $1 AND m.link_id = $2 AND m.provider_id IS NULL
                    AND d.message_id = m.id AND d.generation = $5 AND d.state = 'running'
                    AND d.checkpoint->>'stage' = 'creating'
            "#,correlation,lease.mailbox.link_id,lease.provider_id.as_str(),thread_provider_id,lease.mailbox.sync_generation)
                .execute(&mut *tx).await.map_err(db_error)?;
        }
        let existing = sqlx::query!(
            r#"
            SELECT id,thread_id,is_sent,is_draft,provider_version,
                COALESCE((mailbox_state->>'in_trash')::boolean,false) AS "in_trash!",
                COALESCE((mailbox_state->>'provider_missing')::boolean,false) AS "provider_missing!"
            FROM email_messages
            WHERE link_id = $1 AND provider_id = $2 FOR UPDATE
        "#,
            lease.mailbox.link_id,
            lease.provider_id.as_str()
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?;
        if let Some(existing) = &existing
            && version.is_some()
            && version == existing.provider_version
            && !existing.provider_missing
            && existing.in_trash == state.in_trash
        {
            // The persisted version is the durable projection watermark, even
            // after its outbox row has been delivered and removed. Folder ancestry
            // can change derived trash state without changing the message ETag.
            return tx.commit().await.map_err(db_error);
        }
        if let Some(existing) = &existing {
            message.is_sent |= existing.is_sent;
        }
        let shadow = if let Some(existing) = &existing {
            sqlx::query!(
                r#"
                SELECT revision > synced_revision AS "dirty!", delete_requested, base_version
                FROM email_mailbox_drafts WHERE message_id = $1 FOR UPDATE
            "#,
                existing.id
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(db_error)?
        } else {
            None
        };
        if let Some(existing) = &existing {
            sqlx::query!("DELETE FROM email_draft_organization_versions WHERE message_id=$1 AND ($2=versions[cardinality(versions)] OR NOT ($2=ANY(versions)))",existing.id,version)
                .execute(&mut *tx).await.map_err(db_error)?;
            let remote = serde_json::to_value(&message).map_err(|_| MailboxError::Persistence)?;
            sqlx::query!(
                "UPDATE email_mailbox_drafts SET remote_snapshot = $2 WHERE message_id = $1",
                existing.id,
                remote
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
            if message.is_draft
                && shadow
                    .as_ref()
                    .is_some_and(|s| !s.dirty && !s.delete_requested)
            {
                sqlx::query!("UPDATE email_mailbox_drafts SET base_version = $2,error_code = NULL WHERE message_id = $1 AND state = 'synced'",existing.id,version).execute(&mut *tx).await.map_err(db_error)?;
            }
        }
        // A sent snapshot is authoritative even after a timeout, cancellation or
        // a send from Outlook. The same transaction fences any active worker and
        // shares its event key with the delivery coordinator.
        let confirmed_send = if message.is_sent && !message.is_draft {
            if let Some(existing) = &existing {
                let row = sqlx::query!(r#"
                    UPDATE email_mailbox_drafts SET state = 'sent',error_code = NULL,
                        lease_id = NULL,lease_until = NULL,delete_requested = false,updated_at = now()
                    WHERE message_id = $1 AND state <> 'sent' RETURNING checkpoint
                "#,existing.id).fetch_optional(&mut *tx).await.map_err(db_error)?;
                if row.is_some() {
                    sqlx::query!("UPDATE email_scheduled_messages SET sent = true,processing = false,updated_at = now() WHERE message_id = $1 AND link_id = $2",existing.id,lease.mailbox.link_id).execute(&mut *tx).await.map_err(db_error)?;
                }
                row
            } else {
                None
            }
        } else {
            None
        };
        let sent_actor = confirmed_send
            .as_ref()
            .and_then(|row| row.checkpoint.as_ref())
            .map(|value| serde_json::from_value::<DraftCheckpoint>(value.clone()))
            .transpose()
            .map_err(|_| MailboxError::Persistence)?
            .and_then(|checkpoint| checkpoint.submission_started.then_some(checkpoint.actor_id));
        // Messages are grouped by mailbox + conversation ID without requiring a
        // provider-native thread fetch or manufacturing a complete conversation.
        let candidate_thread_id = macro_uuid::generate_uuid_v7();
        let thread_id = if let Some(existing) = &existing {
            // A previously linked draft/message keeps its stable Macro thread,
            // including thread sharing and local composer references.
            existing.thread_id
        } else {
            sqlx::query_scalar!(
                r#"
            INSERT INTO email_threads (id,link_id,provider_id) VALUES ($1,$2,$3)
            ON CONFLICT (link_id,provider_id) WHERE provider_id IS NOT NULL
                DO UPDATE SET provider_id = EXCLUDED.provider_id RETURNING id
        "#,
                candidate_thread_id,
                lease.mailbox.link_id,
                thread_provider_id
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(db_error)?
        };
        if !message.is_draft
            || !shadow
                .as_ref()
                .is_some_and(|s| s.dirty || s.delete_requested)
        {
            // A remote edit invalidates the editor document built from an older
            // version. Unsynced editor state remains in the separate local shadow.
            if let Some(existing) = &existing
                && existing.is_draft
                && existing.provider_version != version
                && shadow.as_ref().is_none_or(|s| s.base_version != version)
            {
                sqlx::query!(
                    "UPDATE email_messages SET body_macro = NULL WHERE id = $1",
                    existing.id
                )
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            }
            email_db_client::messages::insert::insert_message_with_tx(
                &mut tx,
                thread_id,
                &mut message,
                lease.mailbox.link_id,
                recipients,
                false,
            )
            .await
            .map_err(|_| MailboxError::Persistence)?;
        }
        let mut state_json = serde_json::to_value(&state).map_err(|_| MailboxError::Persistence)?;
        if !message.is_sent && shadow.as_ref().is_some_and(|s| s.delete_requested) {
            state_json["provider_missing"] = serde_json::json!(true);
        }
        let message_id = sqlx::query_scalar!(r#"
            UPDATE email_messages SET provider_folder_id = $3,provider_version = $4,mailbox_state = $5,
                remote_draft_revision = CASE WHEN body_macro IS NULL THEN $4 ELSE remote_draft_revision END,
                is_read = COALESCE((SELECT (desired #>> '{}')::boolean FROM email_pending_mailbox_state p WHERE p.message_id = email_messages.id AND p.attribute = 'is_read'),is_read),
                is_starred = COALESCE((SELECT (desired #>> '{}')::boolean FROM email_pending_mailbox_state p WHERE p.message_id = email_messages.id AND p.attribute = 'is_flagged'),is_starred)
            WHERE link_id = $1 AND provider_id = $2 RETURNING id
        "#,lease.mailbox.link_id,lease.provider_id.as_str(),folder_id.as_ref().map(ProviderId::as_str),version,state_json)
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        // A remote snapshot replaces category membership, including an empty set.
        // Outlook category names are assignment identities, separate from folders.
        sqlx::query!(
            "DELETE FROM email_message_labels WHERE message_id = $1",
            message_id
        )
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
        let deleting = sqlx::query_scalar!("SELECT resource_key FROM email_mailbox_settings_work WHERE link_id=$1 AND kind='delete_label' AND completed_revision<revision",lease.mailbox.link_id)
            .fetch_all(&mut *tx).await.map_err(db_error)?;
        for tag in tags.into_iter().filter(|tag| !deleting.contains(tag)) {
            let label_id = sqlx::query_scalar!(r#"
                INSERT INTO email_labels (id,link_id,provider_label_id,name,type) VALUES ($1,$2,$3::text,$3::text,'User')
                ON CONFLICT (link_id,provider_label_id) DO UPDATE SET name = EXCLUDED.name RETURNING id
            "#,macro_uuid::generate_uuid_v7(),lease.mailbox.link_id,tag).fetch_one(&mut *tx).await.map_err(db_error)?;
            sqlx::query!("INSERT INTO email_message_labels (message_id,label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",message_id,label_id)
                .execute(&mut *tx).await.map_err(db_error)?;
        }
        email_db_client::threads::update::recompute_thread_metadata(
            &mut tx,
            thread_id,
            lease.mailbox.link_id,
        )
        .await
        .map_err(db_error)?;
        email_db_client::threads::update::sync_thread_calendar_flag(&mut tx, thread_id)
            .await
            .map_err(|_| MailboxError::Persistence)?;
        email_db_client::messages::replying_to_id::update_thread_messages_replying_to(
            &mut tx,
            thread_id,
            lease.mailbox.link_id,
        )
        .await
        .map_err(|_| MailboxError::Persistence)?;
        let payload = serde_json::json!({
            "kind":"message", "message_id":message_id,"thread_id":thread_id,
            "provider_id":lease.provider_id.as_str(),"is_import":lease.is_import,
            "is_new":existing.is_none(),"is_new_thread":thread_id == candidate_thread_id,"was_draft":confirmed_send.is_some() || (shadow.is_none() && existing.as_ref().is_some_and(|m|m.is_draft)),
            "is_draft":message.is_draft,"is_sent":message.is_sent,
            "version":version,"actor":sent_actor,
            "calendar_parts":content.calendar_parts,
        });
        let dedupe = if confirmed_send.is_some() {
            Some(format!("send/{}/{}", lease.mailbox.link_id, message_id))
        } else {
            version.map(|version| {
                format!(
                    "{}/{}/{}/{}",
                    lease.mailbox.link_id,
                    lease.mailbox.sync_generation,
                    lease.provider_id.as_str(),
                    version
                )
            })
        };
        sqlx::query!(r#"
            INSERT INTO email_projection_outbox (id,link_id,generation,payload,dedupe_key) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT (dedupe_key) DO NOTHING
        "#,macro_uuid::generate_uuid_v7(),lease.mailbox.link_id,lease.mailbox.sync_generation,payload,dedupe)
            .execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }

    async fn absent(&self, lease: &MessageLease) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        let active = sqlx::query!("SELECT id FROM email_links WHERE id = $1 AND sync_generation = $2 AND grant_generation = $3 AND is_sync_active FOR UPDATE",lease.mailbox.link_id,lease.mailbox.sync_generation,lease.mailbox.grant_generation)
            .fetch_optional(&mut *tx).await.map_err(db_error)?;
        if active.is_none() {
            return Err(MailboxError::Stale);
        }
        let work = sqlx::query!(r#"
            SELECT revision FROM email_message_reconciliation
            WHERE link_id = $1 AND generation = $2 AND provider_id = $3 AND lease_id = $4 AND lease_until > now() FOR UPDATE
        "#,lease.mailbox.link_id,lease.mailbox.sync_generation,lease.provider_id.as_str(),lease.lease_id)
            .fetch_optional(&mut *tx).await.map_err(db_error)?;
        if work.is_none() {
            return Err(MailboxError::Stale);
        }
        let rows = sqlx::query!(r#"
            UPDATE email_messages SET mailbox_state = COALESCE(mailbox_state,'{}'::jsonb) || '{"provider_missing":true}'::jsonb
            WHERE link_id = $1 AND provider_id = $2 AND (NOT is_draft OR body_macro IS NULL) RETURNING id,thread_id
        "#,lease.mailbox.link_id,lease.provider_id.as_str()).fetch_all(&mut *tx).await.map_err(db_error)?;
        for row in rows {
            email_db_client::threads::update::recompute_thread_metadata(
                &mut tx,
                row.thread_id,
                lease.mailbox.link_id,
            )
            .await
            .map_err(db_error)?;
            let payload =
                serde_json::json!({"kind":"absent","message_id":row.id,"thread_id":row.thread_id});
            sqlx::query!("INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),lease.mailbox.link_id,lease.mailbox.sync_generation,payload)
                .execute(&mut *tx).await.map_err(db_error)?;
        }
        // Keep bodies, local draft revisions and attachments for reconciliation;
        // absence in a folder or a single 404 is never a hard-delete instruction.
        tx.commit().await.map_err(db_error)
    }
}
