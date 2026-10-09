use super::*;
use crate::domain::{
    mailbox::{lifecycle::*, projection::ProjectionEvent},
    models::UserProvider,
};
use models_email::service::pubsub::DeletionReason;

#[cfg(test)]
mod test;
use sqlx::{PgConnection, Postgres, Transaction};

fn failed<E>(_: E) -> InboxLifecycleError {
    InboxLifecycleError::Unavailable
}

async fn snapshot(
    conn: &mut PgConnection,
    link: Uuid,
) -> Result<InboxLifecycleSnapshot, InboxLifecycleError> {
    let row=sqlx::query!(r#"SELECT l.id,l.macro_id,l.provider::text AS "provider!",l.sync_generation,l.grant_id,l.grant_generation,l.fusionauth_user_id,
        l.disconnect_requested_at,EXISTS(SELECT 1 FROM promoted_shared_mailboxes p WHERE p.macro_id = l.macro_id) AS "promoted!"
        FROM email_links l WHERE l.id = $1 FOR UPDATE OF l"#,link).fetch_optional(&mut *conn).await.map_err(failed)?.ok_or(InboxLifecycleError::NotFound)?;
    let delegates=sqlx::query_scalar!("SELECT primary_macro_id FROM macro_user_links WHERE link_id = $1 AND child_macro_id = $2 ORDER BY primary_macro_id",link,row.macro_id)
        .fetch_all(&mut *conn).await.map_err(failed)?;
    let custodians=sqlx::query!("SELECT actor_id,fusionauth_user_id,grant_id,grant_generation,granted_scopes FROM email_mailbox_custodians WHERE link_id = $1 ORDER BY verified_at DESC,actor_id",link)
        .fetch_all(&mut *conn).await.map_err(failed)?.into_iter().map(|row|MailboxCustodian {actor_id:row.actor_id,credential_owner:row.fusionauth_user_id,grant_id:row.grant_id,grant_generation:row.grant_generation,scopes:row.granted_scopes}).collect();
    Ok(InboxLifecycleSnapshot {
        link_id: link,
        owner: row.macro_id,
        provider: match row.provider.as_str() {
            "GMAIL" => UserProvider::Gmail,
            "OUTLOOK" => UserProvider::Outlook,
            _ => return Err(InboxLifecycleError::Unavailable),
        },
        promoted: row.promoted,
        delegates,
        sync_generation: row.sync_generation,
        grant_id: row.grant_id,
        grant_generation: row.grant_generation,
        credential_owner: row.fusionauth_user_id,
        disconnecting: row.disconnect_requested_at.is_some(),
        custodians,
    })
}

async fn enqueue(
    tx: &mut Transaction<'_, Postgres>,
    link: Uuid,
    effect: InboxLifecycleEffect,
) -> Result<(), InboxLifecycleError> {
    let payload = serde_json::to_value(effect).map_err(failed)?;
    sqlx::query!(
        "INSERT INTO email_mailbox_lifecycle_outbox(id,link_id,payload) VALUES ($1,$2,$3)",
        macro_uuid::generate_uuid_v7(),
        link,
        payload
    )
    .execute(&mut **tx)
    .await
    .map_err(failed)?;
    Ok(())
}

impl InboxLifecycleRepository for PgMailboxSync {
    async fn snapshot(&self, link: Uuid) -> Result<InboxLifecycleSnapshot, InboxLifecycleError> {
        snapshot(&mut *self.db.acquire().await.map_err(failed)?, link).await
    }
    async fn remove(
        &self,
        actor: &InboxActor,
        expected: &InboxLifecycleSnapshot,
        decision: &InboxRemoval,
        reason: DeletionReason,
    ) -> Result<(), InboxLifecycleError> {
        let mut tx = self.db.begin().await.map_err(failed)?;
        let current = snapshot(&mut tx, expected.link_id).await?;
        if &current != expected {
            return Err(InboxLifecycleError::Changed);
        }
        if current.disconnecting {
            return Ok(());
        }
        let link = current.link_id;
        sqlx::query!("DELETE FROM macro_user_links WHERE link_id = $1 AND primary_macro_id = $2 AND child_macro_id = $3",link,actor.macro_id.as_ref(),current.owner)
            .execute(&mut *tx).await.map_err(failed)?;
        // Emit the leaving viewer's refresh outside the link-scoped projection
        // queue, which deliberately stops processing after mailbox removal.
        enqueue(
            &mut tx,
            link,
            InboxLifecycleEffect::AccessRemoved {
                viewer: actor.macro_id.to_string(),
            },
        )
        .await?;
        let mut revoke = current
            .custodians
            .iter()
            .filter(|candidate| {
                matches!(decision, InboxRemoval::Disconnect)
                    || candidate.actor_id == actor.macro_id.as_ref()
            })
            .cloned()
            .collect::<Vec<_>>();
        if (matches!(decision, InboxRemoval::Disconnect)
            || matches!(
                decision,
                InboxRemoval::Detach {
                    replace_custodian: true,
                    ..
                }
            ))
            && let Some(grant_id) = current.grant_id
        {
            revoke.push(MailboxCustodian {
                actor_id: actor.macro_id.to_string(),
                credential_owner: current.credential_owner.clone(),
                grant_id,
                grant_generation: current.grant_generation,
                scopes: vec![],
            });
        }
        match decision {
            InboxRemoval::Disconnect => {
                sqlx::query!("UPDATE email_links SET is_sync_active = false,disconnect_requested_at = now(),sync_generation = sync_generation + 1,updated_at = now() WHERE id = $1",link)
                    .execute(&mut *tx).await.map_err(failed)?;
                if current.provider == UserProvider::Outlook && current.grant_id.is_some() {
                    let watches = sqlx::query!(
                        "SELECT id,provider_id FROM email_provider_subscriptions WHERE link_id=$1",
                        link
                    )
                    .fetch_all(&mut *tx)
                    .await
                    .map_err(failed)?;
                    if !watches.is_empty() {
                        enqueue(
                            &mut tx,
                            link,
                            InboxLifecycleEffect::CleanupMicrosoftWatches {
                                grant_generation: current.grant_generation,
                                sync_generation: current.sync_generation + 1,
                                attempt_ids: watches.iter().map(|w| w.id).collect(),
                                provider_ids: watches
                                    .into_iter()
                                    .filter_map(|w| w.provider_id)
                                    .collect(),
                            },
                        )
                        .await?;
                    }
                }
                // Frozen Gmail work cannot publish stale changes after disconnect.
                sqlx::query!("DELETE FROM email_mailbox_lifecycle_outbox WHERE link_id=$1 AND payload->>'kind' IN ('gmail_history','gmail_backfill')",link)
                    .execute(&mut *tx).await.map_err(failed)?;
                sqlx::query!(
                    "DELETE FROM email_mailbox_custodians WHERE link_id = $1",
                    link
                )
                .execute(&mut *tx)
                .await
                .map_err(failed)?;
                enqueue(
                    &mut tx,
                    link,
                    InboxLifecycleEffect::DeleteMailbox { reason },
                )
                .await?;
                for viewer in &current.delegates {
                    if viewer != actor.macro_id.as_ref() {
                        enqueue(
                            &mut tx,
                            link,
                            InboxLifecycleEffect::AccessRemoved {
                                viewer: viewer.clone(),
                            },
                        )
                        .await?;
                    }
                }
            }
            InboxRemoval::Detach {
                replace_custodian,
                replacement,
            } => {
                sqlx::query!(
                    "DELETE FROM email_mailbox_custodians WHERE link_id = $1 AND actor_id = $2",
                    link,
                    actor.macro_id.as_ref()
                )
                .execute(&mut *tx)
                .await
                .map_err(failed)?;
                if *replace_custodian {
                    let generation = replacement
                        .as_ref()
                        .map_or(current.grant_generation + 1, |candidate| {
                            candidate.grant_generation
                        });
                    let owner = replacement
                        .as_ref()
                        .map_or(current.credential_owner.as_str(), |candidate| {
                            candidate.credential_owner.as_str()
                        });
                    let grant = replacement.as_ref().map(|candidate| candidate.grant_id);
                    let scopes = replacement
                        .as_ref()
                        .map_or(&[][..], |candidate| candidate.scopes.as_slice());
                    let row=sqlx::query!(r#"UPDATE email_links SET grant_id = $2,grant_generation = $3,fusionauth_user_id = $4,
                        sync_generation = sync_generation + 1,needs_reauth = $5,last_sync_error_at = CASE WHEN $5 THEN now() ELSE NULL END,updated_at = now()
                        WHERE id = $1 RETURNING sync_generation"#,link,grant,generation,owner,replacement.is_none()).fetch_one(&mut *tx).await.map_err(failed)?;
                    sqlx::query!(r#"INSERT INTO email_link_microsoft_scopes(link_id,grant_generation,granted_scopes) VALUES ($1,$2,$3)
                        ON CONFLICT(link_id) DO UPDATE SET grant_generation = EXCLUDED.grant_generation,granted_scopes = EXCLUDED.granted_scopes,updated_at = now()"#,link,generation,scopes).execute(&mut *tx).await.map_err(failed)?;
                    rebind_work(&mut tx, link, current.sync_generation, row.sync_generation)
                        .await?;
                    let event = if replacement.is_none() {
                        ProjectionEvent::ReauthorizationRequired
                    } else {
                        ProjectionEvent::LinkChanged
                    };
                    let payload = serde_json::to_value(event).map_err(failed)?;
                    sqlx::query!("INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),link,row.sync_generation,payload)
                        .execute(&mut *tx).await.map_err(failed)?;
                }
            }
        }
        revoke.sort_by_key(|grant| (grant.grant_id, grant.grant_generation));
        revoke.dedup_by_key(|grant| (grant.grant_id, grant.grant_generation));
        for grant in revoke {
            enqueue(
                &mut tx,
                link,
                InboxLifecycleEffect::RevokeMicrosoftGrant {
                    grant_id: grant.grant_id,
                    generation: grant.grant_generation,
                    owner: grant.credential_owner,
                },
            )
            .await?;
        }
        tx.commit().await.map_err(failed)
    }

    async fn resync(
        &self,
        _actor: &InboxActor,
        expected: &InboxLifecycleSnapshot,
    ) -> Result<InboxResync, InboxLifecycleError> {
        let mut tx = self.db.begin().await.map_err(failed)?;
        let current = snapshot(&mut tx, expected.link_id).await?;
        if &current != expected {
            return Err(InboxLifecycleError::Changed);
        }
        let link = current.link_id;
        let result = match current.provider {
            UserProvider::Gmail => {
                let existing=sqlx::query_scalar!("SELECT id FROM email_backfill_jobs WHERE link_id = $1 AND status IN ('Init','InProgress') LIMIT 1",link).fetch_optional(&mut *tx).await.map_err(failed)?;
                if let Some(id) = existing {
                    InboxResync {
                        run_id: id,
                        already_in_progress: true,
                    }
                } else {
                    let id = macro_uuid::generate_uuid_v7();
                    let inserted=sqlx::query_scalar!(r#"INSERT INTO email_backfill_jobs(id,link_id,fusionauth_user_id,status,is_recovery) VALUES ($1,$2,$3,'Init',false)
                        ON CONFLICT(link_id) WHERE status IN ('Init','InProgress') DO NOTHING RETURNING id"#,id,link,current.credential_owner).fetch_optional(&mut *tx).await.map_err(failed)?;
                    if inserted.is_some() {
                        enqueue(
                            &mut tx,
                            link,
                            InboxLifecycleEffect::GmailBackfill { job_id: id },
                        )
                        .await?;
                        InboxResync {
                            run_id: id,
                            already_in_progress: false,
                        }
                    } else {
                        let id=sqlx::query_scalar!("SELECT id FROM email_backfill_jobs WHERE link_id = $1 AND status IN ('Init','InProgress') LIMIT 1",link).fetch_one(&mut *tx).await.map_err(failed)?;
                        InboxResync {
                            run_id: id,
                            already_in_progress: true,
                        }
                    }
                }
            }
            UserProvider::Outlook => {
                let stream=sqlx::query!("SELECT id,initial_complete FROM email_sync_streams WHERE link_id = $1 AND generation = $2 AND kind = 'folder_catalog' LIMIT 1",link,current.sync_generation).fetch_optional(&mut *tx).await.map_err(failed)?;
                let in_progress=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_sync_streams WHERE link_id = $1 AND generation = $2 AND kind IN ('folder_catalog','mail_folder') AND NOT initial_complete)
                    OR EXISTS(SELECT 1 FROM email_message_reconciliation WHERE link_id = $1 AND generation = $2 AND is_import) AS "running!""#,link,current.sync_generation).fetch_one(&mut *tx).await.map_err(failed)?;
                let run_id = stream
                    .as_ref()
                    .map_or_else(macro_uuid::generate_uuid_v7, |stream| stream.id);
                if !in_progress || stream.is_none() {
                    sqlx::query!("INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id) VALUES ($1,$2,$3,'folder_catalog','mail') ON CONFLICT DO NOTHING",run_id,link,current.sync_generation).execute(&mut *tx).await.map_err(failed)?;
                    sqlx::query!(r#"UPDATE email_sync_streams SET position = NULL,initial_complete = false, attachments_rechecked = false,scan_id = gen_random_uuid(),next_run_at = now(),fence = fence + 1,lease_id = NULL,lease_until = NULL
                        WHERE link_id = $1 AND generation = $2 AND kind IN ('folder_catalog','mail_folder','contacts_catalog','contacts_profile','contacts')"#,link,current.sync_generation).execute(&mut *tx).await.map_err(failed)?;
                    sqlx::query!(r#"INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import)
                        SELECT link_id,$2,provider_id,true FROM email_messages WHERE link_id = $1 AND provider_id IS NOT NULL
                        ON CONFLICT(link_id,generation,provider_id) DO UPDATE SET revision = email_message_reconciliation.revision + 1,available_at = now()"#,link,current.sync_generation).execute(&mut *tx).await.map_err(failed)?;
                }
                InboxResync {
                    run_id,
                    already_in_progress: in_progress && stream.is_some(),
                }
            }
        };
        tx.commit().await.map_err(failed)?;
        Ok(result)
    }

    async fn bindings_for_deleted_user(
        &self,
        owner: &str,
    ) -> Result<Vec<(InboxActor, Uuid)>, InboxLifecycleError> {
        let rows=sqlx::query!(r#"SELECT c.link_id AS "link_id!",c.actor_id AS "actor_id!" FROM email_mailbox_custodians c WHERE c.fusionauth_user_id = $1
            UNION SELECT l.id AS link_id,l.macro_id AS actor_id FROM email_links l WHERE l.fusionauth_user_id = $1
                AND NOT EXISTS(SELECT 1 FROM promoted_shared_mailboxes p WHERE p.macro_id = l.macro_id)"#,owner).fetch_all(&self.db).await.map_err(failed)?;
        rows.into_iter()
            .map(|row| {
                Ok((
                    InboxActor {
                        macro_id: macro_user_id::user_id::MacroUserIdStr::try_from(row.actor_id)
                            .map_err(failed)?,
                        credential_owner: owner.into(),
                    },
                    row.link_id,
                ))
            })
            .collect()
    }
    async fn ready_for_delete(&self, link: Uuid) -> Result<bool, InboxLifecycleError> {
        sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_links l WHERE l.id=$1 AND NOT l.is_sync_active
            AND l.disconnect_requested_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM email_mailbox_lifecycle_outbox o
                WHERE o.link_id=l.id AND o.payload->>'kind' IN ('cleanup_microsoft_watches','revoke_microsoft_grant'))) AS "ready!""#,link)
            .fetch_one(&self.db).await.map_err(failed)
    }
    async fn claim_effect(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<InboxLifecycleLease>, MailboxError> {
        let row=sqlx::query!(r#"WITH candidate AS (SELECT o.id FROM email_mailbox_lifecycle_outbox o WHERE o.available_at <= now()
            AND (o.lease_until IS NULL OR o.lease_until < now())
            AND NOT EXISTS (SELECT 1 FROM email_mailbox_lifecycle_outbox prerequisite WHERE prerequisite.link_id=o.link_id
                AND ((o.payload->>'kind'='revoke_microsoft_grant' AND prerequisite.payload->>'kind'='cleanup_microsoft_watches')
                    OR (o.payload->>'kind'='delete_mailbox' AND prerequisite.payload->>'kind' IN ('cleanup_microsoft_watches','revoke_microsoft_grant'))))
            ORDER BY (o.payload->>'kind' = 'gmail_history'),o.available_at,o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED)
            UPDATE email_mailbox_lifecycle_outbox o SET lease_id = $1,lease_until = now() + interval '3 minutes',attempts = attempts + 1
            FROM candidate c WHERE o.id = c.id RETURNING o.id,o.link_id,o.payload"#,lease_id).fetch_optional(&self.db).await.map_err(db_error)?;
        row.map(|row| {
            Ok(InboxLifecycleLease {
                id: row.id,
                lease_id,
                link_id: row.link_id,
                effect: serde_json::from_value(row.payload)
                    .map_err(|_| MailboxError::Persistence)?,
            })
        })
        .transpose()
    }
    async fn finish_effect(
        &self,
        lease: &InboxLifecycleLease,
        success: bool,
    ) -> Result<(), MailboxError> {
        if success {
            sqlx::query!("DELETE FROM email_mailbox_lifecycle_outbox WHERE id = $1 AND lease_id = $2 AND lease_until > now()",lease.id,lease.lease_id).execute(&self.db).await.map_err(db_error)?;
        } else {
            sqlx::query!("UPDATE email_mailbox_lifecycle_outbox SET lease_id = NULL,lease_until = NULL,available_at = now() + make_interval(secs => LEAST(600,attempts * 30)) WHERE id = $1 AND lease_id = $2",lease.id,lease.lease_id).execute(&self.db).await.map_err(db_error)?;
        }
        Ok(())
    }
}

/// Rebind durable work without throwing away checkpoints or replaying an
/// uncertain draft submission. Expired workers fail both their lease and epoch.
async fn rebind_work(
    tx: &mut Transaction<'_, Postgres>,
    link: Uuid,
    old: i64,
    new: i64,
) -> Result<(), InboxLifecycleError> {
    sqlx::query!("UPDATE email_mailbox_watch_work SET next_run_at=now(),revision=revision+1 WHERE link_id=$1",link)
        .execute(&mut **tx).await.map_err(failed)?;
    sqlx::query!(r#"INSERT INTO email_sync_streams(id,link_id,generation,kind,scope_id,position,initial_complete,scan_id)
        SELECT gen_random_uuid(),link_id,$3,kind,scope_id,position,initial_complete,scan_id FROM email_sync_streams WHERE link_id = $1 AND generation = $2
        ON CONFLICT DO NOTHING"#,link,old,new).execute(&mut **tx).await.map_err(failed)?;
    sqlx::query!(r#"INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import)
        SELECT link_id,$3,provider_id,is_import FROM email_message_reconciliation WHERE link_id = $1 AND generation = $2 ON CONFLICT DO NOTHING"#,link,old,new).execute(&mut **tx).await.map_err(failed)?;
    sqlx::query!(r#"UPDATE email_mailbox_drafts SET generation = $3,lease_id = NULL,lease_until = NULL,
        state = CASE WHEN state = 'running' THEN 'pending' ELSE state END,available_at = now(),updated_at = now() WHERE link_id = $1 AND generation = $2"#,link,old,new).execute(&mut **tx).await.map_err(failed)?;
    sqlx::query!(r#"UPDATE email_mailbox_commands SET generation = $3,lease_id = NULL,lease_until = NULL,
        status = CASE WHEN status = 'running' THEN 'pending' ELSE status END,available_at = now(),updated_at = now()
        WHERE link_id = $1 AND generation = $2 AND status IN ('pending','running','confirming')"#,link,old,new).execute(&mut **tx).await.map_err(failed)?;
    Ok(())
}
