#[cfg(test)]
mod test;
use super::{EmailPgRepo, draft, message, thread};
use crate::domain::{
    draft_transfer::*,
    mailbox::{MailboxError, MailboxKey},
    models::{
        AttachmentDraft, EmailErr, ResolvedDraftInput, ThreadRow, UpsertedContacts, UserProvider,
    },
};
use chrono::Utc;
use sqlx::PgConnection;
use uuid::Uuid;

fn db(error: sqlx::Error) -> EmailErr {
    EmailErr::RepoErr(error.into())
}
fn invalid() -> EmailErr {
    EmailErr::InvalidDraft("The draft changed while moving; reload it and try again".into())
}
fn provider(value: &str) -> Result<UserProvider, EmailErr> {
    match value {
        "GMAIL" => Ok(UserProvider::Gmail),
        "OUTLOOK" => Ok(UserProvider::Outlook),
        _ => Err(invalid()),
    }
}

async fn lock_links(
    tx: &mut PgConnection,
    actor: &str,
    request: &DraftTransferRequest,
) -> Result<(MailboxKey, MailboxKey, UserProvider, UserProvider, String), EmailErr> {
    let ids = vec![request.source_link_id, request.destination_link_id];
    let rows=sqlx::query!(r#"SELECT id,provider::text AS "provider!",email_address,sync_generation,grant_generation,is_sync_active,
        (macro_id=$2 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$2)) AS "authorized!"
        FROM email_links l WHERE id=ANY($1) ORDER BY id FOR UPDATE"#,&ids,actor).fetch_all(tx).await.map_err(db)?;
    if rows.len() != 2
        || rows
            .iter()
            .any(|row| !row.authorized || !row.is_sync_active)
    {
        return Err(EmailErr::Unauthorized);
    }
    let source = rows
        .iter()
        .find(|r| r.id == request.source_link_id)
        .ok_or_else(invalid)?;
    let destination = rows
        .iter()
        .find(|r| r.id == request.destination_link_id)
        .ok_or_else(invalid)?;
    Ok((
        MailboxKey {
            link_id: source.id,
            sync_generation: source.sync_generation,
            grant_generation: source.grant_generation,
        },
        MailboxKey {
            link_id: destination.id,
            sync_generation: destination.sync_generation,
            grant_generation: destination.grant_generation,
        },
        provider(&source.provider)?,
        provider(&destination.provider)?,
        destination.email_address.clone(),
    ))
}

async fn source_facts(
    tx: &mut PgConnection,
    request: &DraftTransferRequest,
) -> Result<
    (
        chrono::DateTime<Utc>,
        Option<String>,
        Option<String>,
        Uuid,
        ResolvedDraftInput,
    ),
    EmailErr,
> {
    let row=sqlx::query!(r#"SELECT m.updated_at,m.provider_id,m.thread_id,
        CASE WHEN l.provider='OUTLOOK' THEN COALESCE(d.checkpoint->'draft'->>'version',m.provider_version,d.base_version) ELSE m.provider_history_id END AS version,
        m.is_draft,m.is_sent,
        (COALESCE(d.delete_requested,false) OR EXISTS(SELECT 1 FROM email_draft_transfers t WHERE t.source_id=m.id AND t.state<>'preparing')) AS "retired!",
        (EXISTS(SELECT 1 FROM email_scheduled_messages s WHERE s.message_id=m.id)
            OR EXISTS(SELECT 1 FROM email_attachments_drafts a WHERE a.draft_id=m.id AND a.upload_pending)
            OR COALESCE(d.lease_until>now(),false) OR COALESCE(d.state IN ('conflict','unknown'),false)
            OR COALESCE(d.checkpoint->>'stage' NOT IN ('inspect','ready'),false)) AS "busy!",
        EXISTS(SELECT 1 FROM email_draft_transfers t WHERE t.destination_id=m.id AND t.state NOT IN ('ready','retained')) AS "predecessor!",
        jsonb_build_object('db_id',m.id,'thread_db_id',m.thread_id,'subject',COALESCE(m.subject,''),'replying_to_id',m.replying_to_id,
            'body_text',m.body_text,'body_html',m.body_html_sanitized,'body_macro',m.body_macro,'headers_json',m.headers_jsonb,
            'to',COALESCE(recipients.to_addresses,'[]'::jsonb),'cc',COALESCE(recipients.cc_addresses,'[]'::jsonb),'bcc',COALESCE(recipients.bcc_addresses,'[]'::jsonb)) AS "content!"
        FROM email_messages m JOIN email_links l ON l.id=m.link_id LEFT JOIN email_mailbox_drafts d ON d.message_id=m.id
        CROSS JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('email',c.email_address,'name',COALESCE(r.name,c.name))) FILTER(WHERE r.recipient_type='TO') AS to_addresses,
            jsonb_agg(jsonb_build_object('email',c.email_address,'name',COALESCE(r.name,c.name))) FILTER(WHERE r.recipient_type='CC') AS cc_addresses,
            jsonb_agg(jsonb_build_object('email',c.email_address,'name',COALESCE(r.name,c.name))) FILTER(WHERE r.recipient_type='BCC') AS bcc_addresses
            FROM email_message_recipients r JOIN email_contacts c ON c.id=r.contact_id WHERE r.message_id=m.id) recipients
        WHERE m.id=$1 AND m.link_id=$2 FOR UPDATE OF m"#,request.source_id,request.source_link_id).fetch_optional(tx).await.map_err(db)?.ok_or(EmailErr::MessageNotFound(request.source_id))?;
    validate_transfer(TransferEligibility {
        authorized: true,
        draft: row.is_draft && !row.is_sent,
        delivery_or_edit_in_progress: row.busy,
        predecessor_unresolved: row.predecessor,
        retired: row.retired,
    })?;
    let input = serde_json::from_value(row.content).map_err(anyhow::Error::from)?;
    Ok((
        row.updated_at,
        row.provider_id,
        row.version,
        row.thread_id,
        input,
    ))
}

async fn receipt(
    tx: &mut PgConnection,
    plan: &DraftTransferPlan,
) -> Result<DraftTransferReceipt, EmailErr> {
    let value=sqlx::query_scalar!(r#"SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) AS "files!" FROM email_attachments_drafts a WHERE a.draft_id=$1"#,plan.input.db_id).fetch_one(tx).await.map_err(db)?;
    Ok(DraftTransferReceipt {
        id: plan.request.id,
        message_id: plan.input.db_id,
        thread_id: plan.input.thread_db_id,
        source_id: plan.request.source_id,
        source_thread_id: plan.source_thread_id,
        attachments: serde_json::from_value(value).map_err(anyhow::Error::from)?,
    })
}

impl DraftTransferRepository for EmailPgRepo {
    async fn recover_transfer(
        &self,
        actor: &str,
        id: Uuid,
    ) -> Result<Option<DraftTransferReceipt>, EmailErr> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))",
            format!("draft-transfer:{id}")
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        if let Some(row)=sqlx::query!("SELECT actor_id,plan,state,destination_link_id FROM email_draft_transfers WHERE id=$1 FOR UPDATE",id).fetch_optional(&mut *tx).await.map_err(db)? {
            if row.actor_id!=actor {return Err(EmailErr::Unauthorized);}
            if row.state!="preparing" {
                let allowed=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_links l WHERE l.id=$1 AND (l.macro_id=$2 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$2))) AS "allowed!""#,row.destination_link_id,actor).fetch_one(&mut *tx).await.map_err(db)?;
                if !allowed {return Err(EmailErr::Unauthorized);}
                let plan=serde_json::from_value(row.plan).map_err(anyhow::Error::from)?;
                return Ok(Some(receipt(&mut tx,&plan).await?));
            }
        }
        let owner=sqlx::query_scalar!("INSERT INTO email_draft_transfer_cancellations(id,actor_id) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING actor_id",id,actor).fetch_one(&mut *tx).await.map_err(db)?;
        if owner != actor {
            return Err(EmailErr::Unauthorized);
        }
        tx.commit().await.map_err(db)?;
        Ok(None)
    }

    async fn begin_transfer(
        &self,
        actor: &str,
        request: &DraftTransferRequest,
    ) -> Result<TransferPreparation, EmailErr> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let (
            source_mailbox,
            destination_mailbox,
            source_provider,
            destination_provider,
            destination_address,
        ) = lock_links(&mut tx, actor, request).await?;
        sqlx::query!(
            "SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended($1,0))",
            format!("draft-transfer:{}", request.id)
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        let cancelled=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_draft_transfer_cancellations WHERE id=$1) AS "cancelled!""#,request.id).fetch_one(&mut *tx).await.map_err(db)?;
        if cancelled {
            return Err(EmailErr::InvalidDraft(
                "This transfer was cancelled; start a new inbox change".into(),
            ));
        }
        if let Some(row) = sqlx::query!(
            "SELECT actor_id,plan,state FROM email_draft_transfers WHERE id=$1",
            request.id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?
        {
            let plan: DraftTransferPlan =
                serde_json::from_value(row.plan).map_err(anyhow::Error::from)?;
            if row.actor_id != actor || plan.request != *request {
                return Err(EmailErr::Unauthorized);
            }
            if row.state != "preparing" {
                return Ok(TransferPreparation::Completed(
                    receipt(&mut tx, &plan).await?,
                ));
            }
            let (updated, id, version, _, _) = source_facts(&mut tx, request).await?;
            if updated == plan.source_updated_at
                && id == plan.source_provider_id
                && version == plan.source_provider_version
                && source_mailbox == plan.source_mailbox
                && destination_mailbox == plan.destination_mailbox
            {
                return Ok(TransferPreparation::Pending(Box::new(plan)));
            }
        }
        let (
            source_updated_at,
            source_provider_id,
            source_provider_version,
            source_thread_id,
            mut input,
        ) = source_facts(&mut tx, request).await?;
        input.db_id = macro_uuid::generate_uuid_v7();
        input.thread_db_id = macro_uuid::generate_uuid_v7();
        if let Some(reply) = input.replying_to_id
            && let Some(parent) = sqlx::query!("SELECT thread_id,provider_thread_id FROM email_messages WHERE id=$1 AND link_id=$2",reply,request.destination_link_id).fetch_optional(&mut *tx).await.map_err(db)?
        {
            input.thread_db_id = parent.thread_id;
            input.provider_thread_id = parent.provider_thread_id;
        }
        input.provider_id = None;
        input.send_time = None;
        input.actor_id = Some(actor.to_owned());
        input.draft_client_id = None;
        input.thread_client_id = None;
        let uploads=sqlx::query_scalar!(r#"SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) AS "files!" FROM email_attachments_drafts a WHERE a.draft_id=$1"#,request.source_id).fetch_one(&mut *tx).await.map_err(db)?;
        let mut uploads: Vec<AttachmentDraft> =
            serde_json::from_value(uploads).map_err(anyhow::Error::from)?;
        for file in &mut uploads {
            file.content_id
                .get_or_insert_with(|| format!("{}@attachments.macro.com", file.id));
            file.id = macro_uuid::generate_uuid_v7();
            file.draft_id = input.db_id;
        }
        let files=sqlx::query_scalar!(r#"SELECT a.id AS "id!" FROM email_attachments a WHERE a.message_id=$1
            AND NOT EXISTS(SELECT 1 FROM email_draft_attachment_removals r WHERE r.message_id=$1 AND (r.provider_id=a.provider_attachment_id OR trim(both '<>' from r.content_id)=trim(both '<>' from a.content_id)))
            AND NOT EXISTS(SELECT 1 FROM email_attachments_drafts u WHERE u.draft_id=$1 AND trim(both '<>' from a.content_id)=COALESCE(trim(both '<>' from u.content_id),u.id::text||'@attachments.macro.com'))
            AND NOT EXISTS(SELECT 1 FROM email_attachments_fwd f JOIN email_attachments original ON original.id=f.attachment_id WHERE f.message_id=$1 AND (trim(both '<>' from a.content_id)=trim(both '<>' from original.content_id) OR trim(both '<>' from a.content_id)=f.attachment_id::text||'@attachments.macro.com'))
            UNION SELECT attachment_id FROM email_attachments_fwd WHERE message_id=$1"#,request.source_id).fetch_all(&mut *tx).await.map_err(db)?
            .into_iter().map(|source_id|TransferFile {source_id,destination_id:macro_uuid::generate_uuid_v7()}).collect();
        let plan = DraftTransferPlan {
            request: request.clone(),
            actor: actor.to_owned(),
            source_thread_id,
            source_updated_at,
            source_provider_id,
            source_provider_version,
            source_provider,
            source_mailbox,
            destination_mailbox,
            destination_provider,
            destination_address,
            input,
            uploads,
            files,
        };
        let value = serde_json::to_value(&plan).map_err(anyhow::Error::from)?;
        sqlx::query!("INSERT INTO email_draft_transfers(id,actor_id,source_id,destination_id,source_link_id,destination_link_id,source_thread_id,destination_thread_id,plan) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET destination_id=EXCLUDED.destination_id,destination_thread_id=EXCLUDED.destination_thread_id,plan=EXCLUDED.plan,updated_at=now() WHERE email_draft_transfers.state='preparing'",request.id,actor,request.source_id,plan.input.db_id,request.source_link_id,request.destination_link_id,source_thread_id,plan.input.thread_db_id,value).execute(&mut *tx).await.map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(TransferPreparation::Pending(Box::new(plan)))
    }

    async fn reserve_transfer_object(&self, key: &str) -> Result<(), EmailErr> {
        let affected=sqlx::query!("INSERT INTO email_draft_object_cleanup(object_key,available_at) VALUES($1,now()+interval '1 day') ON CONFLICT(object_key) DO UPDATE SET available_at=EXCLUDED.available_at WHERE email_draft_object_cleanup.lease_until IS NULL OR email_draft_object_cleanup.lease_until<now()",key).execute(&self.pool).await.map_err(db)?.rows_affected();
        if affected != 1 {
            return Err(invalid());
        }
        Ok(())
    }

    async fn commit_transfer(
        &self,
        plan: &DraftTransferPlan,
        contacts: &UpsertedContacts,
        files: Vec<MaterializedTransferFile>,
    ) -> Result<DraftTransferReceipt, EmailErr> {
        let mut tx = self.pool.begin().await.map_err(db)?;
        let (source, destination, _, _, _) =
            lock_links(&mut tx, &plan.actor, &plan.request).await?;
        if source != plan.source_mailbox || destination != plan.destination_mailbox {
            return Err(invalid());
        }
        let row = sqlx::query!(
            "SELECT state,plan FROM email_draft_transfers WHERE id=$1 AND actor_id=$2 FOR UPDATE",
            plan.request.id,
            plan.actor
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(db)?;
        let current: DraftTransferPlan =
            serde_json::from_value(row.plan).map_err(anyhow::Error::from)?;
        if row.state != "preparing" {
            return receipt(&mut tx, &current).await;
        }
        if current.input.db_id != plan.input.db_id {
            return Err(invalid());
        }
        let cancelled=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_draft_transfer_cancellations WHERE id=$1) AS "cancelled!""#,plan.request.id).fetch_one(&mut *tx).await.map_err(db)?;
        if cancelled {
            return Err(invalid());
        }
        let (updated, id, version, _, _) = source_facts(&mut tx, &plan.request).await?;
        if updated != plan.source_updated_at
            || id != plan.source_provider_id
            || version != plan.source_provider_version
        {
            return Err(invalid());
        }
        if files.len() != plan.files.len()
            || plan.files.iter().any(|expected| {
                files
                    .iter()
                    .filter(|actual| {
                        actual.source_id == expected.source_id
                            && actual.upload.id == expected.destination_id
                            && actual.upload.draft_id == plan.input.db_id
                            && !actual.upload.upload_pending
                    })
                    .count()
                    != 1
            })
        {
            return Err(invalid());
        }
        let mut uploads = plan.uploads.clone();
        for file in files {
            let active_cleanup=sqlx::query_scalar!("SELECT lease_until>now() AS active FROM email_draft_object_cleanup WHERE object_key=$1 FOR UPDATE",file.upload.s3_key).fetch_optional(&mut *tx).await.map_err(db)?.flatten().unwrap_or(false);
            if active_cleanup {
                return Err(invalid());
            }
            sqlx::query!("INSERT INTO email_attachment_blobs(attachment_id,object_key,sha256,size_bytes) VALUES($1,$2,$3,$4) ON CONFLICT(attachment_id) DO UPDATE SET object_key=EXCLUDED.object_key,sha256=EXCLUDED.sha256,size_bytes=EXCLUDED.size_bytes",file.source_id,file.upload.s3_key,file.upload.sha,i64::from(file.upload.size)).execute(&mut *tx).await.map_err(db)?;
            uploads.push(file.upload);
        }
        // Destination deduplication must not orphan source-native UUIDs that
        // other drafts already forward. Keep those aliases backed by bytes too.
        sqlx::query!(r#"INSERT INTO email_attachment_blobs(attachment_id,object_key,sha256,size_bytes)
            SELECT a.id,u.s3_key,u.sha,u.size::bigint FROM email_attachments a JOIN email_attachments_drafts u
                ON u.draft_id=a.message_id AND trim(both '<>' from a.content_id)=COALESCE(trim(both '<>' from u.content_id),u.id::text||'@attachments.macro.com')
            WHERE a.message_id=$1 AND NOT u.upload_pending
            ON CONFLICT(attachment_id) DO UPDATE SET object_key=EXCLUDED.object_key,sha256=EXCLUDED.sha256,size_bytes=EXCLUDED.size_bytes"#,plan.request.source_id).execute(&mut *tx).await.map_err(db)?;
        sqlx::query!(r#"INSERT INTO email_attachment_blobs(attachment_id,object_key,sha256,size_bytes)
            SELECT DISTINCT ON(a.id) a.id,b.object_key,b.sha256,b.size_bytes FROM email_attachments a
                JOIN email_attachments_fwd f ON f.message_id=a.message_id JOIN email_attachments original ON original.id=f.attachment_id
                JOIN email_attachment_blobs b ON b.attachment_id=original.id
            WHERE a.message_id=$1 AND (trim(both '<>' from a.content_id)=trim(both '<>' from original.content_id) OR trim(both '<>' from a.content_id)=f.attachment_id::text||'@attachments.macro.com')
            ORDER BY a.id,original.id
            ON CONFLICT(attachment_id) DO UPDATE SET object_key=EXCLUDED.object_key,sha256=EXCLUDED.sha256,size_bytes=EXCLUDED.size_bytes"#,plan.request.source_id).execute(&mut *tx).await.map_err(db)?;
        let now = Utc::now();
        let existing_thread = sqlx::query_scalar!(
            "SELECT id FROM email_threads WHERE id=$1 AND link_id=$2",
            plan.input.thread_db_id,
            destination.link_id
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        if existing_thread.is_none() {
            thread::insert_thread(
                &mut tx,
                &ThreadRow {
                    db_id: plan.input.thread_db_id,
                    provider_id: None,
                    link_id: destination.link_id,
                    inbox_visible: false,
                    is_read: true,
                    latest_inbound_message_ts: None,
                    latest_outbound_message_ts: None,
                    latest_non_spam_message_ts: None,
                    created_at: now,
                    updated_at: now,
                    project_id: None,
                },
                destination.link_id,
            )
            .await
            .map_err(db)?;
        }
        if !draft::upsert_draft(
            &mut tx,
            &plan.input,
            plan.input.db_id,
            plan.input.thread_db_id,
            contacts.from_contact_id,
            destination.link_id,
            true,
        )
        .await
        .map_err(db)?
        {
            return Err(invalid());
        }
        message::upsert_recipients(&mut tx, plan.input.db_id, contacts)
            .await
            .map_err(db)?;
        for file in uploads {
            sqlx::query!("INSERT INTO email_attachments_drafts(id,draft_id,file_name,content_type,sha,size,s3_key,content_id,is_inline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",file.id,plan.input.db_id,file.file_name,file.content_type,file.sha,file.size,file.s3_key,file.content_id,file.is_inline).execute(&mut *tx).await.map_err(db)?;
        }
        sqlx::query!("UPDATE email_messages SET has_attachments=EXISTS(SELECT 1 FROM email_attachments_drafts WHERE draft_id=$1) WHERE id=$1",plan.input.db_id).execute(&mut *tx).await.map_err(db)?;
        draft::snapshot_outlook_draft(&mut tx, plan.input.db_id, destination.link_id, &plan.actor)
            .await
            .map_err(db)?;
        draft::snapshot_outlook_draft(&mut tx, plan.request.source_id, source.link_id, &plan.actor)
            .await
            .map_err(db)?;
        sqlx::query!("UPDATE email_mailbox_drafts SET state='deleted',delete_requested=true,checkpoint=NULL,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE message_id=$1",plan.request.source_id).execute(&mut *tx).await.map_err(db)?;
        sqlx::query!("UPDATE email_messages SET mailbox_state=COALESCE(mailbox_state,'{}'::jsonb)||'{\"provider_missing\":true}'::jsonb,updated_at=now() WHERE id=$1",plan.request.source_id).execute(&mut *tx).await.map_err(db)?;
        sqlx::query!("UPDATE email_draft_transfers SET state='cleanup',revision=revision+1,updated_at=now() WHERE id=$1",plan.request.id).execute(&mut *tx).await.map_err(db)?;
        for (thread_id, mailbox) in [
            (plan.source_thread_id, source),
            (plan.input.thread_db_id, destination),
        ] {
            thread::update_thread_metadata(&mut tx, thread_id, mailbox.link_id)
                .await
                .map_err(db)?;
            let payload = serde_json::json!({"kind":"organization","thread_id":thread_id});
            sqlx::query!("INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),mailbox.link_id,mailbox.sync_generation,payload).execute(&mut *tx).await.map_err(db)?;
        }
        thread::upsert_user_history(&mut tx, destination.link_id, plan.input.thread_db_id)
            .await
            .map_err(db)?;
        let receipt = receipt(&mut tx, plan).await?;
        tx.commit().await.map_err(db)?;
        Ok(receipt)
    }

    async fn claim_transfer_cleanup(
        &self,
        lease: Uuid,
    ) -> Result<Option<DraftTransferPlan>, MailboxError> {
        let row=sqlx::query!(r#"WITH candidate AS (SELECT id FROM email_draft_transfers WHERE state='cleanup' AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at LIMIT 1 FOR UPDATE SKIP LOCKED)
            UPDATE email_draft_transfers t SET lease_id=$1,lease_until=now()+interval '5 minutes' FROM candidate c WHERE t.id=c.id RETURNING t.plan"#,lease).fetch_optional(&self.pool).await.map_err(|_|MailboxError::Persistence)?;
        row.map(|r| serde_json::from_value(r.plan).map_err(|_| MailboxError::Persistence))
            .transpose()
    }

    async fn renew_transfer_cleanup(
        &self,
        plan: &DraftTransferPlan,
        lease: Uuid,
    ) -> Result<(), MailboxError> {
        let current = self.transfer_cleanup_binding(plan).await?;
        if current != Some(plan.source_mailbox) {
            return Err(MailboxError::Stale);
        }
        let changed=sqlx::query!("UPDATE email_draft_transfers SET lease_until=now()+interval '5 minutes' WHERE id=$1 AND lease_id=$2 AND lease_until>now() AND state='cleanup'",plan.request.id,lease).execute(&self.pool).await.map_err(|_|MailboxError::Persistence)?.rows_affected();
        if changed != 1 {
            return Err(MailboxError::Stale);
        }
        Ok(())
    }
    async fn transfer_cleanup_binding(
        &self,
        plan: &DraftTransferPlan,
    ) -> Result<Option<MailboxKey>, MailboxError> {
        let row=sqlx::query!(r#"SELECT l.id,l.sync_generation,l.grant_generation FROM email_links l
            WHERE l.id=$1 AND l.is_sync_active AND (l.macro_id=$2 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=l.id AND u.primary_macro_id=$2))
              AND EXISTS(SELECT 1 FROM email_links target WHERE target.id=$3 AND (target.macro_id=$2 OR EXISTS(SELECT 1 FROM macro_user_links u WHERE u.link_id=target.id AND u.primary_macro_id=$2)))"#,
            plan.request.source_link_id,plan.actor,plan.request.destination_link_id).fetch_optional(&self.pool).await.map_err(|_|MailboxError::Persistence)?;
        Ok(row.map(|r| MailboxKey {
            link_id: r.id,
            sync_generation: r.sync_generation,
            grant_generation: r.grant_generation,
        }))
    }

    async fn finish_transfer_cleanup(
        &self,
        plan: &DraftTransferPlan,
        lease: Uuid,
        outcome: RetirementOutcome,
    ) -> Result<(), MailboxError> {
        let (state, issue) = match outcome {
            RetirementOutcome::Removed => ("ready", None),
            RetirementOutcome::Changed => ("conflict", Some("move_conflict")),
            RetirementOutcome::OriginalRemains => ("conflict", Some("move_original_remains")),
            RetirementOutcome::Sent => ("conflict", Some("move_source_sent")),
            RetirementOutcome::Reauthorization => ("conflict", Some("move_reauthorization")),
            RetirementOutcome::Retry => ("cleanup", None),
        };
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|_| MailboxError::Persistence)?;
        let changed=sqlx::query!("UPDATE email_draft_transfers SET state=$3,issue=$4,revision=revision+1,lease_id=NULL,lease_until=NULL,available_at=now()+interval '30 seconds',updated_at=now() WHERE id=$1 AND lease_id=$2 AND lease_until>now() AND state='cleanup'",plan.request.id,lease,state,issue).execute(&mut *tx).await.map_err(|_|MailboxError::Persistence)?.rows_affected();
        if changed != 1 {
            return Err(MailboxError::Stale);
        }
        if issue == Some("move_source_sent")
            && let Some(provider_id) = plan.source_provider_id.as_deref()
        {
            sqlx::query!("INSERT INTO email_message_reconciliation(link_id,generation,provider_id,revision,is_import) VALUES($1,$2,$3,1,false) ON CONFLICT(link_id,generation,provider_id) DO UPDATE SET revision=email_message_reconciliation.revision+1,available_at=now()",plan.source_mailbox.link_id,plan.source_mailbox.sync_generation,provider_id).execute(&mut *tx).await.map_err(|_|MailboxError::Persistence)?;
        }
        if state == "ready" {
            sqlx::query!("INSERT INTO email_draft_object_cleanup(object_key,available_at) SELECT s3_key,now()+interval '1 day' FROM email_attachments_drafts WHERE draft_id=$1 ON CONFLICT DO NOTHING",plan.request.source_id).execute(&mut *tx).await.map_err(|_|MailboxError::Persistence)?;
            sqlx::query!(
                "DELETE FROM email_attachments_drafts WHERE draft_id=$1",
                plan.request.source_id
            )
            .execute(&mut *tx)
            .await
            .map_err(|_| MailboxError::Persistence)?;
        }
        let payload =
            serde_json::json!({"kind":"organization","thread_id":plan.input.thread_db_id});
        sqlx::query!("INSERT INTO email_projection_outbox(id,link_id,generation,payload) VALUES($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),plan.destination_mailbox.link_id,plan.destination_mailbox.sync_generation,payload).execute(&mut *tx).await.map_err(|_|MailboxError::Persistence)?;
        tx.commit().await.map_err(|_| MailboxError::Persistence)
    }
}
