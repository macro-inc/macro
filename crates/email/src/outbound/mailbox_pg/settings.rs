use super::*;
use crate::domain::mailbox::settings::*;
use email_api_client::domain::models::EmailApiError;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{label::Label, link::UserProvider};

#[cfg(test)]
mod test;

async fn authorized(
    tx: &mut sqlx::PgConnection,
    actor: &MacroUserIdStr<'_>,
    link: Uuid,
) -> Result<SettingsMailbox, MailboxError> {
    let row = sqlx::query!(r#"SELECT sync_generation,grant_generation,provider::text AS "provider!" FROM email_links l
        WHERE l.id=$1 AND l.is_sync_active AND l.disconnect_requested_at IS NULL
        AND (l.macro_id=$2 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$2)) FOR UPDATE"#,link,actor.as_ref())
        .fetch_optional(tx).await.map_err(db_error)?.ok_or(EmailApiError::NotFound)?;
    Ok(SettingsMailbox {
        key: MailboxKey {
            link_id: link,
            sync_generation: row.sync_generation,
            grant_generation: row.grant_generation,
        },
        provider: match row.provider.as_str() {
            "OUTLOOK" => UserProvider::Outlook,
            "GMAIL" => UserProvider::Gmail,
            _ => return Err(MailboxError::Persistence),
        },
    })
}
async fn guard(tx: &mut sqlx::PgConnection, lease: &SettingsLease) -> Result<(), MailboxError> {
    let valid = sqlx::query!(
        r#"SELECT s.id FROM email_links l JOIN email_mailbox_settings_work s ON s.link_id=l.id
        WHERE l.id=$1 AND l.sync_generation=$2 AND l.grant_generation=$3 AND l.is_sync_active AND l.disconnect_requested_at IS NULL
        AND s.id=$4 AND s.lease_id=$5 AND s.revision=$6 AND s.lease_until>now() FOR UPDATE OF l,s"#,
        lease.mailbox.key.link_id,
        lease.mailbox.key.sync_generation,
        lease.mailbox.key.grant_generation,
        lease.id,
        lease.lease_id,
        lease.revision
    )
    .fetch_optional(tx)
    .await
    .map_err(db_error)?;
    if valid.is_none() {
        return Err(MailboxError::Stale);
    }
    Ok(())
}
async fn upsert_label(
    tx: &mut sqlx::PgConnection,
    mut label: Label,
) -> Result<Label, MailboxError> {
    let row = sqlx::query!(r#"INSERT INTO email_labels(id,link_id,provider_label_id,name,type)
        VALUES($1,$2,$3,$4,'User') ON CONFLICT(link_id,provider_label_id) DO UPDATE SET name=EXCLUDED.name RETURNING id,created_at"#,
        macro_uuid::generate_uuid_v7(),label.link_id,label.provider_label_id,label.name).fetch_one(tx).await.map_err(db_error)?;
    label.id = Some(row.id);
    label.created_at = row.created_at;
    Ok(label)
}
async fn changed(tx: &mut sqlx::PgConnection, mailbox: MailboxKey) -> Result<(), MailboxError> {
    sqlx::query!(r#"INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES($1,$2,$3,'{"kind":"link_changed"}')"#,
        macro_uuid::generate_uuid_v7(),mailbox.link_id,mailbox.sync_generation).execute(tx).await.map_err(db_error)?;
    Ok(())
}

impl MailboxSettingsRepository for PgMailboxSync {
    async fn accessible(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
    ) -> Result<SettingsMailbox, MailboxError> {
        authorized(
            &mut *self.db.acquire().await.map_err(db_error)?,
            actor,
            link,
        )
        .await
    }
    async fn store_label(
        &self,
        actor: &MacroUserIdStr<'_>,
        mailbox: SettingsMailbox,
        label: Label,
    ) -> Result<Label, MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        if authorized(&mut tx, actor, mailbox.key.link_id).await?.key != mailbox.key {
            return Err(MailboxError::Stale);
        }
        let deleting=sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_mailbox_settings_work WHERE link_id=$1 AND kind='delete_label' AND resource_key=$2 AND completed_revision<revision) AS \"exists!\"",mailbox.key.link_id,label.provider_label_id)
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        if deleting {
            return Err(EmailApiError::Conflict.into());
        }
        let label = upsert_label(&mut tx, label).await?;
        changed(&mut tx, mailbox.key).await?;
        tx.commit().await.map_err(db_error)?;
        Ok(label)
    }
    async fn queue_label_creation(
        &self,
        actor: &MacroUserIdStr<'_>,
        mailbox: SettingsMailbox,
        name: &str,
    ) -> Result<Label, MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        if authorized(&mut tx, actor, mailbox.key.link_id).await?.key != mailbox.key {
            return Err(MailboxError::Stale);
        }
        let deleting = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_mailbox_settings_work WHERE link_id=$1 AND kind='delete_label' AND resource_key=$2 AND completed_revision<revision) AS \"exists!\"", mailbox.key.link_id, name)
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        if deleting {
            return Err(EmailApiError::Conflict.into());
        }
        let existed = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_labels WHERE link_id=$1 AND provider_label_id=$2) AS \"exists!\"", mailbox.key.link_id, name)
            .fetch_one(&mut *tx).await.map_err(db_error)?;
        let label = upsert_label(
            &mut tx,
            Label {
                id: None,
                link_id: mailbox.key.link_id,
                provider_label_id: name.into(),
                name: Some(name.into()),
                created_at: chrono::Utc::now(),
                message_list_visibility: None,
                label_list_visibility: None,
                type_: Some(models_email::service::label::LabelType::User),
            },
        )
        .await?;
        if !existed {
            sqlx::query!(r#"INSERT INTO email_mailbox_settings_work(id,link_id,kind,resource_key)
                VALUES($1,$2,'create_label',$3) ON CONFLICT(link_id,kind,resource_key)
                DO UPDATE SET revision=email_mailbox_settings_work.revision+1,next_run_at=now(),failure=NULL"#,
                macro_uuid::generate_uuid_v7(),mailbox.key.link_id,name).execute(&mut *tx).await.map_err(db_error)?;
            changed(&mut tx, mailbox.key).await?;
        }
        tx.commit().await.map_err(db_error)?;
        Ok(label)
    }
    async fn commit_created_label(
        &self,
        lease: &SettingsLease,
        label: Label,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        if lease.kind != "create_label"
            || label.link_id != lease.mailbox.key.link_id
            || label.provider_label_id != lease.resource
        {
            return Err(MailboxError::Persistence);
        }
        upsert_label(&mut tx, label).await?;
        sqlx::query!("UPDATE email_mailbox_settings_work SET completed_revision=revision,lease_id=NULL,lease_until=NULL,failure=NULL WHERE id=$1",lease.id)
            .execute(&mut *tx).await.map_err(db_error)?;
        changed(&mut tx, lease.mailbox.key).await?;
        tx.commit().await.map_err(db_error)
    }
    async fn delete_label(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        label: Uuid,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        let mailbox = authorized(&mut tx, actor, link).await?;
        let row = sqlx::query!(
            "SELECT provider_label_id FROM email_labels WHERE id=$1 AND link_id=$2 AND type='User'",
            label,
            link
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?
        .ok_or(EmailApiError::NotFound)?;
        sqlx::query!(r#"INSERT INTO email_mailbox_settings_work(id,link_id,kind,resource_key) VALUES($1,$2,'delete_label',$3)
            ON CONFLICT(link_id,kind,resource_key) DO UPDATE SET revision=email_mailbox_settings_work.revision+1,next_run_at=now(),failure=NULL"#,
            macro_uuid::generate_uuid_v7(),link,row.provider_label_id).execute(&mut *tx).await.map_err(db_error)?;
        // Invalidate delayed creation commits. Keep an active lease until it
        // expires so deletion follows any already-started provider request.
        sqlx::query!("UPDATE email_mailbox_settings_work SET revision=revision+1,completed_revision=revision+1 WHERE link_id=$1 AND kind='create_label' AND resource_key=$2 AND completed_revision<revision",link,row.provider_label_id)
            .execute(&mut *tx).await.map_err(db_error)?;
        // Retain the catalog row until remote cleanup is confirmed. Message
        // assignments are removed immediately and suppressed during cleanup.
        sqlx::query!("DELETE FROM email_message_labels WHERE label_id=$1", label)
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        changed(&mut tx, mailbox.key).await?;
        tx.commit().await.map_err(db_error)
    }
    async fn sender_block(
        &self,
        actor: &MacroUserIdStr<'_>,
        link: Uuid,
        sender: &str,
        blocked: bool,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        let mailbox = authorized(&mut tx, actor, link).await?;
        super::super::email_pg_repo::sender_policy::enqueue(&mut tx, link, sender, blocked)
            .await
            .map_err(db_error)?;
        changed(&mut tx, mailbox.key).await?;
        tx.commit().await.map_err(db_error)
    }
    async fn sender_intents(
        &self,
        mailbox: SettingsMailbox,
    ) -> Result<Vec<SenderRuleIntent>, MailboxError> {
        Ok(sqlx::query!("SELECT id,resource_key,desired,revision>completed_revision AS \"pending!\" FROM email_mailbox_settings_work WHERE link_id=$1 AND kind='sender_block'",mailbox.key.link_id)
            .fetch_all(&self.db).await.map_err(db_error)?.into_iter().map(|r|SenderRuleIntent {id:r.id,sender:r.resource_key,desired:r.desired,pending:r.pending}).collect())
    }
    async fn pending_operations(
        &self,
        mailbox: SettingsMailbox,
    ) -> Result<Vec<MailboxSettingsOperation>, MailboxError> {
        let rows=sqlx::query!(r#"SELECT s.id,s.kind,s.resource_key,s.desired,s.failure IS NOT NULL AS "failed!"
            FROM email_mailbox_settings_work s JOIN email_links l ON l.id=s.link_id
            WHERE l.id=$1 AND l.sync_generation=$2 AND l.grant_generation=$3
                AND l.is_sync_active AND l.disconnect_requested_at IS NULL
                AND s.kind<>'catalog' AND s.completed_revision<s.revision ORDER BY s.kind,s.resource_key"#,
            mailbox.key.link_id,mailbox.key.sync_generation,mailbox.key.grant_generation).fetch_all(&self.db).await.map_err(db_error)?;
        rows.into_iter()
            .map(|r| {
                Ok(MailboxSettingsOperation {
                    id: r.id,
                    kind: match r.kind.as_str() {
                        "create_label" => MailboxSettingsChange::CreateLabel,
                        "delete_label" => MailboxSettingsChange::DeleteLabel,
                        "sender_block" => MailboxSettingsChange::SenderBlock,
                        _ => return Err(MailboxError::Persistence),
                    },
                    resource: r.resource_key,
                    enabled: r.desired,
                    needs_attention: r.failed,
                })
            })
            .collect()
    }
    async fn claim_settings(
        &self,
        lease_id: Uuid,
        outlook_sync: bool,
        outlook_writes: bool,
    ) -> Result<Option<SettingsLease>, MailboxError> {
        let row=sqlx::query!(r#"WITH candidate AS (
            SELECT s.id FROM email_links l JOIN email_mailbox_settings_work s ON s.link_id=l.id
            WHERE (l.provider<>'OUTLOOK' OR (s.kind='catalog' AND $2) OR (s.kind<>'catalog' AND $3))
            AND l.is_sync_active AND l.disconnect_requested_at IS NULL AND s.next_run_at<=now() AND (s.kind='catalog' OR s.revision>s.completed_revision)
            AND (s.lease_until IS NULL OR s.lease_until<now())
            AND (s.kind<>'delete_label' OR NOT EXISTS(SELECT 1 FROM email_mailbox_commands c
                WHERE c.link_id=s.link_id AND c.generation=l.sync_generation AND c.status IN ('pending','running','confirming')
                AND c.intent->>'kind'='category' AND c.intent->'value'->>'name'=s.resource_key))
            AND NOT EXISTS(SELECT 1 FROM email_mailbox_settings_work busy WHERE busy.link_id=l.id AND busy.lease_until>now())
            ORDER BY s.next_run_at,s.id LIMIT 1 FOR UPDATE OF l,s SKIP LOCKED
        ) UPDATE email_mailbox_settings_work s SET lease_id=$1,lease_until=now()+interval '3 minutes',attempts=attempts+1
        FROM candidate c,email_links l WHERE s.id=c.id AND l.id=s.link_id
        RETURNING s.id,s.link_id,s.revision,s.kind,s.resource_key,s.desired,l.sync_generation,l.grant_generation,l.provider::text AS "provider!""#,lease_id,outlook_sync,outlook_writes)
            .fetch_optional(&self.db).await.map_err(db_error)?;
        row.map(|r| {
            Ok(SettingsLease {
                id: r.id,
                lease_id,
                revision: r.revision,
                kind: r.kind,
                resource: r.resource_key,
                desired: r.desired,
                mailbox: SettingsMailbox {
                    key: MailboxKey {
                        link_id: r.link_id,
                        sync_generation: r.sync_generation,
                        grant_generation: r.grant_generation,
                    },
                    provider: match r.provider.as_str() {
                        "GMAIL" => UserProvider::Gmail,
                        "OUTLOOK" => UserProvider::Outlook,
                        _ => return Err(MailboxError::Persistence),
                    },
                },
            })
        })
        .transpose()
    }
    async fn renew_settings(&self, lease: &SettingsLease) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        sqlx::query!("UPDATE email_mailbox_settings_work SET lease_until=now()+interval '3 minutes' WHERE id=$1",lease.id).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }
    async fn commit_labels(
        &self,
        lease: &SettingsLease,
        labels: &[Label],
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        let deleting=sqlx::query_scalar!("SELECT resource_key FROM email_mailbox_settings_work WHERE link_id=$1 AND kind='delete_label' AND completed_revision<revision",lease.mailbox.key.link_id)
            .fetch_all(&mut *tx).await.map_err(db_error)?;
        let creating=sqlx::query_scalar!("SELECT resource_key FROM email_mailbox_settings_work WHERE link_id=$1 AND kind='create_label' AND completed_revision<revision",lease.mailbox.key.link_id)
            .fetch_all(&mut *tx).await.map_err(db_error)?;
        let mut names = creating;
        for label in labels
            .iter()
            .filter(|l| !deleting.contains(&l.provider_label_id))
        {
            names.push(label.provider_label_id.clone());
            upsert_label(&mut tx, label.clone()).await?;
        }
        sqlx::query!(r#"DELETE FROM email_labels l WHERE l.link_id=$1 AND l.type='User' AND NOT(l.provider_label_id=ANY($2))
            AND NOT EXISTS(SELECT 1 FROM email_message_labels m WHERE m.label_id=l.id)
            AND NOT(l.provider_label_id=ANY($3))"#,lease.mailbox.key.link_id,&names,&deleting).execute(&mut *tx).await.map_err(db_error)?;
        changed(&mut tx, lease.mailbox.key).await?;
        tx.commit().await.map_err(db_error)
    }
    async fn reconcile_settings_message(
        &self,
        lease: &SettingsLease,
        message: &ProviderId,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        sqlx::query!(r#"INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import) VALUES($1,$2,$3,false)
            ON CONFLICT(link_id,generation,provider_id) DO UPDATE SET revision=email_message_reconciliation.revision+1,available_at=now()"#,
            lease.mailbox.key.link_id,lease.mailbox.key.sync_generation,message.as_str()).execute(&mut *tx).await.map_err(db_error)?;
        tx.commit().await.map_err(db_error)
    }
    async fn finish_settings(
        &self,
        lease: &SettingsLease,
        complete: bool,
        delay: u32,
        failure: Option<&str>,
    ) -> Result<(), MailboxError> {
        let mut tx = self.db.begin().await.map_err(db_error)?;
        guard(&mut tx, lease).await?;
        if complete && lease.kind == "delete_label" {
            sqlx::query!("DELETE FROM email_message_labels m USING email_labels l WHERE m.label_id=l.id AND l.link_id=$1 AND l.provider_label_id=$2",lease.mailbox.key.link_id,lease.resource)
                .execute(&mut *tx).await.map_err(db_error)?;
            sqlx::query!(
                "DELETE FROM email_labels WHERE link_id=$1 AND provider_label_id=$2",
                lease.mailbox.key.link_id,
                lease.resource
            )
            .execute(&mut *tx)
            .await
            .map_err(db_error)?;
        }
        sqlx::query!(r#"UPDATE email_mailbox_settings_work SET completed_revision=CASE WHEN $2 THEN revision ELSE completed_revision END,
            next_run_at=now()+make_interval(secs=>$3),lease_id=NULL,lease_until=NULL,failure=$4 WHERE id=$1"#,lease.id,complete,f64::from(delay),failure)
            .execute(&mut *tx).await.map_err(db_error)?;
        if complete {
            changed(&mut tx, lease.mailbox.key).await?;
        }
        tx.commit().await.map_err(db_error)
    }
}
