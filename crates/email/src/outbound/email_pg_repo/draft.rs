use super::{client_id_mapping, message, thread};
use crate::domain::models::{
    EmailErr, ResolvedDraftInput, SettledDraftIds, ThreadRow, UpsertedContacts,
};
use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

pub(super) async fn operation_facts(
    pool: &PgPool,
    ids: &[Uuid],
) -> Result<
    std::collections::HashMap<
        Uuid,
        crate::domain::models::mailbox_operation::MessageOperationFacts,
    >,
    sqlx::Error,
> {
    use crate::domain::models::mailbox_operation::MessageOperationFacts;
    let rows = sqlx::query!("SELECT d.message_id,d.state,d.revision,m.provider_version,d.error_code,d.checkpoint->>'stage' AS stage FROM email_mailbox_drafts d JOIN email_messages m ON m.id = d.message_id WHERE d.message_id = ANY($1)",ids).fetch_all(pool).await?;
    let mut result = rows
        .into_iter()
        .map(|row| {
            Ok((
                row.message_id,
                MessageOperationFacts {
                    state: operation_enum(row.state)?,
                    stage: row.stage.map(operation_enum).transpose()?,
                    revision: row.revision,
                    remote_version: row.provider_version,
                    issue: row.error_code.map(operation_enum).transpose()?,
                },
            ))
        })
        .collect::<Result<std::collections::HashMap<_, _>, sqlx::Error>>()?;
    let moves=sqlx::query!("SELECT id,destination_id,state,revision,issue FROM email_draft_transfers WHERE destination_id=ANY($1) AND state IN ('cleanup','conflict')",ids).fetch_all(pool).await?;
    for row in moves {
        result.insert(
            row.destination_id,
            MessageOperationFacts {
                state: if row.state == "cleanup" {
                    crate::domain::models::mailbox_operation::StoredOperationState::Pending
                } else {
                    crate::domain::models::mailbox_operation::StoredOperationState::Conflict
                },
                stage: None,
                revision: row.revision,
                remote_version: Some(format!("transfer:{}", row.id)),
                issue: Some(operation_enum(
                    row.issue.unwrap_or_else(|| "move_pending".into()),
                )?),
            },
        );
    }
    Ok(result)
}

fn operation_enum<T: serde::de::DeserializeOwned>(value: String) -> Result<T, sqlx::Error> {
    serde_json::from_value(serde_json::Value::String(value))
        .map_err(|error| sqlx::Error::Decode(Box::new(error)))
}

/// Insert a draft message within a transaction.
/// Includes: thread insert (if new), message upsert, scheduled message, recipients,
/// thread metadata update, and user history.
/// Returns the IDs the save settled on, or `None` (rolling everything back)
/// when the upsert's owner guard rejected the write — the message ID exists
/// under another inbox or is no longer an unsent draft.
#[tracing::instrument(skip(pool, input, contacts, new_thread), err)]
pub(crate) async fn insert_message(
    pool: &PgPool,
    input: &ResolvedDraftInput,
    contacts: &UpsertedContacts,
    link_id: Uuid,
    new_thread: Option<ThreadRow>,
    is_draft: bool,
) -> Result<Option<SettledDraftIds>, EmailErr> {
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;

    // Match the mailbox workers' link -> message lock order, and revalidate the
    // actor at the transaction that accepts an Outlook write.
    let mailbox = sqlx::query!(r#"
        SELECT macro_id,
            ($2::text = macro_id OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = email_links.id AND u.primary_macro_id = $2)) AS authorized
        FROM email_links WHERE id = $1 AND provider = 'OUTLOOK' FOR UPDATE
    "#,link_id,input.actor_id).fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?;
    if mailbox
        .as_ref()
        .is_some_and(|mailbox| mailbox.authorized != Some(true))
    {
        return Err(EmailErr::Unauthorized);
    }

    let mut settled = SettledDraftIds {
        message_db_id: input.db_id,
        thread_db_id: input.thread_db_id,
    };
    let mut new_thread = new_thread;

    // The caller resolved this handle on its own connection, where a
    // concurrent first save's binding is invisible until it commits — so two
    // first saves of one draft would each mint a message and a thread, and the
    // losing binding upsert would orphan a full row set. Serialize on the
    // handle and re-read the binding under the lock: the loser adopts the row
    // the winner settled on and updates it instead.
    if let Some(client_id) = input.draft_client_id {
        client_id_mapping::lock_draft_client_id(&mut tx, client_id, link_id)
            .await
            .map_err(anyhow::Error::from)?;
        if let Some(bound) = client_id_mapping::bound_draft_row(&mut tx, client_id, link_id)
            .await
            .map_err(anyhow::Error::from)?
            && bound.message_db_id != settled.message_db_id
        {
            settled = bound;
            // Our thread would have no messages left to hold.
            new_thread = None;
        }
    }

    let SettledDraftIds {
        message_db_id,
        thread_db_id,
    } = settled;

    // Serialize with schedule/cancel/claim before checking editability. The
    // domain's earlier read cannot protect a save waiting on this transaction.
    let existing = sqlx::query!(
        "SELECT link_id, is_sent, is_draft, (EXISTS (SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id = email_messages.id AND d.delete_requested) OR EXISTS(SELECT 1 FROM email_draft_transfers t WHERE t.source_id=email_messages.id AND t.state<>'preparing')) AS \"deleted!\" FROM email_messages WHERE id = $1 FOR UPDATE",
        message_db_id,
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    let was_missing = existing.is_none();
    if let Some(existing) = existing {
        if existing.link_id != link_id || existing.is_sent || !existing.is_draft || existing.deleted
        {
            return Ok(None);
        }
        let scheduled = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2) AS \"exists!\"",
            message_db_id, link_id,
        ).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
        if scheduled {
            return Err(EmailErr::MessageDeliveryConflict(message_db_id));
        }
    }

    if let Some(thread) = new_thread {
        thread::insert_thread(&mut tx, &thread, link_id)
            .await
            .map_err(anyhow::Error::from)?;
    }

    let updated = upsert_draft(
        &mut tx,
        input,
        message_db_id,
        thread_db_id,
        contacts.from_contact_id,
        link_id,
        is_draft,
    )
    .await
    .map_err(anyhow::Error::from)?;
    if !updated {
        return Ok(None);
    }

    // A first save can miss an uncommitted insert in the initial SELECT, then
    // wait on its unique-key conflict. ON CONFLICT's subquery keeps that older
    // statement snapshot, so recheck after the upsert owns the message lock.
    // A concurrent insert+schedule must roll back this entire stale write.
    if was_missing {
        let deleted = sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_mailbox_drafts WHERE message_id = $1 AND delete_requested) AS \"deleted!\"",message_db_id).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
        if deleted {
            return Err(EmailErr::MessageNotFound(message_db_id));
        }
        let scheduled = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM email_scheduled_messages WHERE message_id = $1 AND link_id = $2) AS \"exists!\"",
            message_db_id, link_id,
        ).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
        if scheduled {
            return Err(EmailErr::MessageDeliveryConflict(message_db_id));
        }
    }

    // Only immediate Send persists its internal undo-window delivery here.
    // Ordinary draft writes never touch scheduling, even for legacy clients.
    if !is_draft && input.send_time.is_some() {
        require_completed_uploads(&mut tx, message_db_id).await?;
        message::process_scheduled_message(
            &mut tx,
            link_id,
            message_db_id,
            input.send_time,
            input.actor_id.as_deref(),
        )
        .await
        .map_err(anyhow::Error::from)?;
    }

    message::upsert_recipients(&mut tx, message_db_id, contacts)
        .await
        .map_err(anyhow::Error::from)?;

    if let Some(mailbox) = mailbox {
        snapshot_outlook_draft(
            &mut tx,
            message_db_id,
            link_id,
            input.actor_id.as_deref().unwrap_or(&mailbox.macro_id),
        )
        .await
        .map_err(anyhow::Error::from)?;
    }

    thread::update_thread_metadata(&mut tx, thread_db_id, link_id)
        .await
        .map_err(anyhow::Error::from)?;

    thread::upsert_user_history(&mut tx, link_id, thread_db_id)
        .await
        .map_err(anyhow::Error::from)?;

    // Persist handles with the actual settled identity, including a concurrent
    // first-save winner and a draft recreated after sender migration.
    if let Some(client_id) = input.draft_client_id {
        client_id_mapping::bind_draft_client_id(&mut tx, client_id, link_id, message_db_id)
            .await
            .map_err(anyhow::Error::from)?;
    }
    if let Some(client_id) = input.thread_client_id {
        client_id_mapping::bind_thread_client_id(&mut tx, client_id, link_id, thread_db_id)
            .await
            .map_err(anyhow::Error::from)?;
    }

    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Some(settled))
}

/// Upsert a draft message row.
///
/// The conflict clause is owner-guarded: an existing row is only updated when
/// it is an unsent draft in the sending inbox. The IDs reaching this upsert
/// come from validated reads, but reads race — the guard, not the read, is
/// what keeps a raced save from rewriting another inbox's row or a sent
/// message. Returns `false` when the guard rejected the write.
pub(crate) async fn upsert_draft(
    tx: &mut sqlx::PgConnection,
    input: &ResolvedDraftInput,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    from_contact_id: Option<Uuid>,
    link_id: Uuid,
    is_draft: bool,
) -> Result<bool, sqlx::Error> {
    let now = Utc::now();

    let result = sqlx::query!(
        r#"
        INSERT INTO email_messages (
            id, provider_id, link_id, thread_id, provider_thread_id,
            replying_to_id, subject, from_contact_id, sent_at,
            has_attachments, is_read, is_starred, is_sent, is_draft,
            body_text, body_html_sanitized, body_macro, headers_jsonb,
            created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (id) DO UPDATE SET
            provider_id = COALESCE(email_messages.provider_id, EXCLUDED.provider_id),
            thread_id = EXCLUDED.thread_id,
            provider_thread_id = COALESCE(email_messages.provider_thread_id, EXCLUDED.provider_thread_id),
            replying_to_id = EXCLUDED.replying_to_id,
            subject = EXCLUDED.subject,
            from_contact_id = EXCLUDED.from_contact_id,
            sent_at = EXCLUDED.sent_at,
            is_read = EXCLUDED.is_read,
            is_starred = EXCLUDED.is_starred,
            is_sent = EXCLUDED.is_sent,
            is_draft = EXCLUDED.is_draft,
            body_text = EXCLUDED.body_text,
            body_html_sanitized = EXCLUDED.body_html_sanitized,
            body_macro = EXCLUDED.body_macro,
            headers_jsonb = EXCLUDED.headers_jsonb,
            updated_at = NOW()
        WHERE email_messages.link_id = EXCLUDED.link_id
          AND email_messages.is_draft AND NOT email_messages.is_sent
          AND NOT EXISTS (SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id = EXCLUDED.id AND d.delete_requested)
          AND NOT EXISTS (SELECT 1 FROM email_scheduled_messages WHERE message_id = EXCLUDED.id AND link_id = EXCLUDED.link_id)
        "#,
        message_db_id,
        input.provider_id,
        link_id,
        thread_db_id,
        input.provider_thread_id,
        input.replying_to_id,
        input.subject,
        from_contact_id,
        now,
        false, // has_attachments
        true,  // is_read
        false, // is_starred
        false, // is_sent
        is_draft,
        input.body_text,
        input.body_html,
        input.body_macro,
        input.headers_json,
        now,
        now,
    )
    .execute(&mut *tx)
    .await?;

    Ok(result.rows_affected() == 1)
}

/// Snapshot the committed payload in the same transaction as its edit or schedule.
/// The caller holds the mailbox and message locks and supplies the verified actor.
pub(super) async fn snapshot_outlook_draft(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    link_id: Uuid,
    actor: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(r#"
        INSERT INTO email_mailbox_drafts (message_id,link_id,generation,actor_id,desired_content,base_version,provider_id)
        SELECT m.id,m.link_id,l.sync_generation,$3,
            jsonb_build_object('db_id',m.id,'provider_id',m.provider_id,'replying_to_id',m.replying_to_id,
                'provider_thread_id',m.provider_thread_id,'thread_db_id',m.thread_id,'subject',COALESCE(m.subject,''),
                'body_text',m.body_text,'body_html',m.body_html_sanitized,'body_macro',m.body_macro,'headers_json',m.headers_jsonb,
                'actor_id',$3::text,'send_time',(SELECT send_time FROM email_scheduled_messages WHERE message_id = m.id),
                'to',COALESCE(recipients.to_addresses,'[]'::jsonb),'cc',COALESCE(recipients.cc_addresses,'[]'::jsonb),'bcc',COALESCE(recipients.bcc_addresses,'[]'::jsonb),
                '_attachments',jsonb_build_object(
                    'uploads',COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM email_attachments_drafts a WHERE a.draft_id = m.id AND NOT a.upload_pending),'[]'::jsonb),
                    'forwarded',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'mime_type',a.mime_type,'content_id',a.content_id,
                        'provider_attachment_id',a.provider_attachment_id,'provider_id',source.provider_id,'link_id',source.link_id,'thread_id',source.thread_id,'grant_generation',sl.grant_generation) ORDER BY a.id)
                        FROM email_attachments_fwd f JOIN email_attachments a ON a.id = f.attachment_id JOIN email_messages source ON source.id = a.message_id JOIN email_links sl ON sl.id = source.link_id
                        WHERE f.message_id = m.id),'[]'::jsonb),
                    'removals',COALESCE((SELECT jsonb_agg(CASE WHEN r.provider_id IS NOT NULL THEN jsonb_build_object('kind','provider_id','value',r.provider_id) ELSE jsonb_build_object('kind','content_id','value',r.content_id) END ORDER BY r.id)
                        FROM email_draft_attachment_removals r WHERE r.message_id = m.id),'[]'::jsonb))),
            COALESCE((SELECT versions[cardinality(versions)] FROM email_draft_organization_versions v
                WHERE v.message_id=m.id AND m.provider_version=ANY(v.versions)),m.provider_version),m.provider_id
        FROM email_messages m JOIN email_links l ON l.id = m.link_id
        CROSS JOIN LATERAL (
            SELECT jsonb_agg(jsonb_build_object('email',c.email_address,'name',COALESCE(r.name,c.name))) FILTER (WHERE r.recipient_type = 'TO') AS to_addresses,
                jsonb_agg(jsonb_build_object('email',c.email_address,'name',COALESCE(r.name,c.name))) FILTER (WHERE r.recipient_type = 'CC') AS cc_addresses,
                jsonb_agg(jsonb_build_object('email',c.email_address,'name',COALESCE(r.name,c.name))) FILTER (WHERE r.recipient_type = 'BCC') AS bcc_addresses
            FROM email_message_recipients r JOIN email_contacts c ON c.id = r.contact_id WHERE r.message_id = m.id
        ) recipients
        WHERE m.id = $1 AND m.link_id = $2 AND l.provider = 'OUTLOOK'
        ON CONFLICT (message_id) DO UPDATE SET
            revision = email_mailbox_drafts.revision + 1,desired_content = EXCLUDED.desired_content,actor_id = EXCLUDED.actor_id,
            checkpoint = CASE WHEN email_mailbox_drafts.state = 'synced' OR (email_mailbox_drafts.state='failed' AND email_mailbox_drafts.error_code='invalid_content') THEN NULL ELSE email_mailbox_drafts.checkpoint END,
            error_code = CASE WHEN email_mailbox_drafts.state='failed' AND email_mailbox_drafts.error_code='invalid_content' THEN NULL ELSE email_mailbox_drafts.error_code END,
            state = CASE WHEN email_mailbox_drafts.state IN ('synced','failed','cancelled') THEN 'pending' ELSE email_mailbox_drafts.state END,
            available_at = now(),updated_at = now()
    "#,message_id,link_id,actor).execute(&mut *tx).await?;
    sqlx::query!(
        "DELETE FROM email_draft_organization_versions WHERE message_id=$1",
        message_id
    )
    .execute(tx)
    .await?;
    Ok(())
}

pub(super) async fn require_completed_uploads(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
) -> Result<(), EmailErr> {
    let blocked=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_draft_transfers WHERE (destination_id=$1 AND state NOT IN ('ready','retained','preparing')) OR (source_id=$1 AND state<>'preparing')) AS "blocked!""#,message_id).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
    if blocked {
        return Err(EmailErr::InvalidDraft(
            "Resolve the original draft before sending this copy".into(),
        ));
    }
    let pending=sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM email_attachments_drafts WHERE draft_id=$1 AND upload_pending) AS \"pending!\"",message_id)
        .fetch_one(tx).await.map_err(anyhow::Error::from)?;
    if pending {
        return Err(EmailErr::InvalidDraft(
            "Finish or remove unfinished attachment uploads before sending".into(),
        ));
    }
    Ok(())
}
