use crate::domain::{
    models::{
        AttachmentDraft, AttachmentForwarded, ContactInfo, DraftDeletion, MessageAttachment,
        MessageLabel, MessageTimestamps, RecipientType, SimpleMessageInfo, UpsertedContacts,
    },
    ports::RecipientsByMessageId,
};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

use super::db_types::{
    DbDraftAttachmentRow, DbForwardedAttachmentRow, DbMessageAttachmentRow, DbMessageLabelRow,
    DbRecipientRow, DbRecipientType, DbSenderRow, DbSimpleMessageRow,
};

#[tracing::instrument(err, skip(pool))]
pub(super) async fn message_timestamps(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
) -> Result<Option<MessageTimestamps>, sqlx::Error> {
    sqlx::query_as!(
        MessageTimestamps,
        "SELECT created_at, updated_at FROM email_messages WHERE id = $1 AND link_id = $2",
        message_id,
        link_id,
    )
    .fetch_optional(pool)
    .await
}

#[tracing::instrument(err, skip(pool, message_ids))]
pub(super) async fn senders_by_message_ids(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, ContactInfo>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        DbSenderRow,
        r#"
        SELECT
            m.id as message_id,
            c.email_address,
            COALESCE(m.from_name, c.name) as "name",
            c.sfs_photo_url
        FROM email_messages m
        INNER JOIN email_contacts c ON c.id = m.from_contact_id
        WHERE m.id = ANY($1)
        AND m.from_contact_id IS NOT NULL
        "#,
        message_ids,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let (message_id, contact): (Uuid, ContactInfo) = row.into();
            (message_id, contact)
        })
        .collect())
}

#[tracing::instrument(err, skip(pool, message_ids))]
pub(super) async fn recipients_by_message_ids(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<RecipientsByMessageId, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        DbRecipientRow,
        r#"
        SELECT
            mr.message_id,
            c.email_address,
            COALESCE(mr.name, c.name) as "name",
            c.sfs_photo_url,
            mr.recipient_type as "recipient_type!: DbRecipientType"
        FROM email_messages m
        JOIN email_message_recipients mr ON m.id = mr.message_id
        JOIN email_contacts c ON mr.contact_id = c.id
        WHERE m.id = ANY($1)
        ORDER BY mr.message_id, mr.recipient_type
        "#,
        message_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<(ContactInfo, RecipientType)>> = HashMap::new();
    for row in rows {
        let (message_id, contact, r_type) =
            <DbRecipientRow as Into<(Uuid, ContactInfo, RecipientType)>>::into(row);
        map.entry(message_id).or_default().push((contact, r_type));
    }
    Ok(map)
}

#[tracing::instrument(err, skip(pool, message_ids))]
pub(super) async fn labels_by_message_ids(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<MessageLabel>>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        DbMessageLabelRow,
        r#"
        SELECT
            ml.message_id AS "message_id!",
            l.id,
            l.link_id,
            l.provider_label_id,
            l.name,
            l.created_at,
            l.message_list_visibility as "message_list_visibility: _",
            l.label_list_visibility as "label_list_visibility: _",
            l.type as "type_: _"
        FROM email_effective_message_labels ml
        JOIN email_labels l ON ml.label_id = l.id
        WHERE ml.message_id = ANY($1)
        ORDER BY ml.message_id, l.name
        "#,
        message_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<MessageLabel>> = HashMap::new();
    for row in rows {
        let (message_id, label) = <DbMessageLabelRow as Into<(Uuid, MessageLabel)>>::into(row);
        map.entry(message_id).or_default().push(label);
    }
    Ok(map)
}

#[tracing::instrument(err, skip(pool, message_ids))]
pub(super) async fn attachments_by_message_ids(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<MessageAttachment>>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        DbMessageAttachmentRow,
        r#"
        SELECT
            ea.message_id,
            ea.id,
            ea.provider_attachment_id,
            ea.filename,
            ea.mime_type,
            ea.size_bytes,
            eas.sfs_id as "sfs_id?",
            ea.content_id, ea.reference_url
        FROM email_attachments ea
        JOIN email_messages message ON message.id = ea.message_id
        LEFT JOIN email_attachments_sfs eas ON ea.id = eas.attachment_id
        WHERE ea.message_id = ANY($1)
            AND (message.is_sent OR (
                NOT EXISTS (SELECT 1 FROM email_draft_attachment_removals r WHERE r.message_id = message.id AND (r.provider_id = ea.provider_attachment_id OR trim(both '<>' from r.content_id) = trim(both '<>' from ea.content_id)))
                AND NOT EXISTS (SELECT 1 FROM email_attachments_drafts d WHERE d.draft_id = message.id AND trim(both '<>' from ea.content_id) = COALESCE(trim(both '<>' from d.content_id),d.id::text || '@attachments.macro.com'))
                AND NOT EXISTS (SELECT 1 FROM email_attachments_fwd f JOIN email_attachments original ON original.id = f.attachment_id
                    WHERE f.message_id = message.id AND (trim(both '<>' from ea.content_id) = f.attachment_id::text || '@attachments.macro.com' OR trim(both '<>' from ea.content_id) = trim(both '<>' from original.content_id)))))
        ORDER BY ea.message_id, ea.filename NULLS LAST
        "#,
        message_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<MessageAttachment>> = HashMap::new();
    for row in rows {
        let (message_id, att) =
            <DbMessageAttachmentRow as Into<(Uuid, MessageAttachment)>>::into(row);
        map.entry(message_id).or_default().push(att);
    }
    Ok(map)
}

#[tracing::instrument(err, skip(pool, message_ids))]
pub(super) async fn draft_attachments_by_message_ids(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<AttachmentDraft>>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        DbDraftAttachmentRow,
        r#"
        SELECT id, draft_id, file_name, content_type, sha, size, s3_key, upload_pending, content_id, is_inline
        FROM email_attachments_drafts
        WHERE draft_id = ANY($1)
        ORDER BY draft_id, file_name ASC
        "#,
        message_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<AttachmentDraft>> = HashMap::new();
    for row in rows {
        let (draft_id, att) = <DbDraftAttachmentRow as Into<(Uuid, AttachmentDraft)>>::into(row);
        map.entry(draft_id).or_default().push(att);
    }
    Ok(map)
}

#[tracing::instrument(err, skip(pool, message_ids))]
pub(super) async fn forwarded_attachments_by_message_ids(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<AttachmentForwarded>>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let rows = sqlx::query_as!(
        DbForwardedAttachmentRow,
        r#"
        SELECT
            eaf.message_id as draft_id,
            eaf.attachment_id,
            ea.provider_attachment_id,
            orig_msg.provider_id as "message_provider_id!",
            ea.filename,
            ea.mime_type,
            ea.size_bytes
        FROM email_attachments_fwd eaf
        JOIN email_attachments ea ON eaf.attachment_id = ea.id
        JOIN email_messages orig_msg ON ea.message_id = orig_msg.id
        WHERE eaf.message_id = ANY($1)
        ORDER BY eaf.message_id, ea.filename ASC
        "#,
        message_ids,
    )
    .fetch_all(pool)
    .await?;

    let mut map: HashMap<Uuid, Vec<AttachmentForwarded>> = HashMap::new();
    for row in rows {
        let (draft_id, att) =
            <DbForwardedAttachmentRow as Into<(Uuid, AttachmentForwarded)>>::into(row);
        map.entry(draft_id).or_default().push(att);
    }
    Ok(map)
}

#[tracing::instrument(err, skip(pool, message_ids))]
pub(super) async fn scheduled_send_times_by_message_ids(
    pool: &PgPool,
    message_ids: &[Uuid],
) -> Result<HashMap<Uuid, DateTime<Utc>>, sqlx::Error> {
    if message_ids.is_empty() {
        return Ok(HashMap::new());
    }

    struct DbScheduledRow {
        message_id: Uuid,
        send_time: DateTime<Utc>,
    }

    let rows = sqlx::query_as!(
        DbScheduledRow,
        r#"
        SELECT message_id, send_time
        FROM email_scheduled_messages
        WHERE message_id = ANY($1) AND sent = false
        "#,
        message_ids,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| (r.message_id, r.send_time))
        .collect())
}

/// Fetch a simplified message by DB ID, scoped to a set of accessible inboxes,
/// for validation. Returns the message's own `link_id` so callers can tell
/// whether the reply target lives in the inbox being sent from.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn get_simple_message(
    pool: &PgPool,
    message_id: Uuid,
    link_ids: &[Uuid],
) -> Result<Option<SimpleMessageInfo>, sqlx::Error> {
    let row = sqlx::query_as!(
        DbSimpleMessageRow,
        r#"
        SELECT
            m.provider_id,
            m.id,
            m.link_id,
            m.thread_id,
            m.provider_thread_id,
            m.headers_jsonb,
            m.is_sent,
            m.is_draft
        FROM email_messages m
        WHERE m.id = $1 AND m.link_id = ANY($2)
        "#,
        message_id,
        link_ids,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(SimpleMessageInfo::from))
}

/// Find an existing draft that replies to the given message, identified by
/// the "Macro-In-Reply-To" header value.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn get_draft_replying_to(
    pool: &PgPool,
    link_id: Uuid,
    replying_to_id: Uuid,
) -> Result<Option<SimpleMessageInfo>, sqlx::Error> {
    let row = sqlx::query_as!(
        DbSimpleMessageRow,
        r#"
        SELECT
            m.provider_id,
            m.id,
            m.link_id,
            m.thread_id,
            m.provider_thread_id,
            m.headers_jsonb,
            m.is_sent,
            m.is_draft
        FROM email_messages m
        WHERE m.link_id = $1
          AND m.is_draft = true
          AND NOT m.is_sent
          AND NOT COALESCE((m.mailbox_state->>'provider_missing')::boolean,false)
          AND NOT EXISTS(SELECT 1 FROM email_mailbox_drafts d WHERE d.message_id=m.id AND d.delete_requested)
          AND NOT EXISTS(SELECT 1 FROM email_draft_transfers t WHERE t.source_id=m.id AND t.state<>'preparing')
          AND (m.replying_to_id=$2::uuid OR jsonb_path_exists(
              m.headers_jsonb,
              '$[*] ? (@."Macro-In-Reply-To" == $macro_uuid)'::jsonpath,
              jsonb_build_object('macro_uuid', $2::uuid::text)
          ))
        ORDER BY m.created_at DESC
        LIMIT 1
        "#,
        link_id,
        replying_to_id,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(SimpleMessageInfo::from))
}

/// Delete an unsent draft in the given thread (dependent rows cascade) and, if
/// the thread is left empty, delete the thread too. The WHERE clause is the
/// ownership enforcement: the row must belong to one of `link_ids`, so sent
/// mail, a mismatched thread, or someone else's row is never touched even
/// when the caller's validation read was raced. No matching row is `None`,
/// not an error — deletes are idempotent.
#[tracing::instrument(skip(pool, link_ids), err)]
pub(crate) async fn delete_draft_message(
    pool: &PgPool,
    message_id: Uuid,
    thread_db_id: Uuid,
    link_ids: &[Uuid],
    actor: Option<&str>,
) -> Result<Option<DraftDeletion>, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let outlook = sqlx::query!(r#"
        SELECT l.id,l.sync_generation FROM email_links l JOIN email_messages m ON m.link_id = l.id
        WHERE m.id = $1 AND m.thread_id = $2 AND l.id = ANY($3) AND l.provider = 'OUTLOOK'
            AND ($4::text = l.macro_id OR EXISTS (SELECT 1 FROM macro_user_links u WHERE u.link_id = l.id AND u.primary_macro_id = $4))
        FOR UPDATE OF l
    "#,message_id,thread_db_id,link_ids,actor).fetch_optional(&mut *tx).await?;

    // Sender migration must not delete a draft whose delivery was committed
    // after the service's initial validation. Match the shared lock order.
    sqlx::query!(
        "SELECT id FROM email_messages WHERE id = $1 FOR UPDATE",
        message_id
    )
    .fetch_optional(&mut *tx)
    .await?;

    let retired=sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM email_draft_transfers WHERE source_id=$1 AND state<>'preparing') AS "retired!""#,message_id).fetch_one(&mut *tx).await?;
    if retired {
        return Ok(None);
    }

    let operation = sqlx::query!("SELECT state,error_code,checkpoint->>'stage' AS stage,lease_until FROM email_mailbox_drafts WHERE message_id=$1 FOR UPDATE",message_id)
        .fetch_optional(&mut *tx).await?;
    if operation.as_ref().is_some_and(|operation| {
        operation
            .lease_until
            .is_some_and(|until| until > chrono::Utc::now())
            || matches!(
                operation.stage.as_deref(),
                Some("submitting" | "confirming")
            )
            || operation.error_code.as_deref() == Some("send_unknown")
    }) {
        return Ok(None);
    }
    sqlx::query!(r#"
        INSERT INTO email_draft_object_cleanup (object_key,available_at)
        SELECT a.s3_key,now() + interval '1 day' FROM email_attachments_drafts a JOIN email_messages m ON m.id = a.draft_id
        WHERE m.id = $1 AND m.thread_id = $2 AND m.link_id = ANY($3) AND m.is_draft AND NOT m.is_sent
            AND NOT EXISTS (SELECT 1 FROM email_scheduled_messages s WHERE s.message_id = m.id)
        ON CONFLICT DO NOTHING
    "#,message_id,thread_db_id,link_ids).execute(&mut *tx).await?;

    if let Some(link) = outlook {
        let queued = sqlx::query!(r#"
            INSERT INTO email_mailbox_drafts (message_id,link_id,generation,actor_id,desired_content,base_version,provider_id,delete_requested)
            SELECT m.id,m.link_id,$3,$4,
                jsonb_build_object('db_id',m.id,'thread_db_id',m.thread_id,'subject',COALESCE(m.subject,''),'to','[]'::jsonb,'cc','[]'::jsonb,'bcc','[]'::jsonb),
                m.provider_version,m.provider_id,true
            FROM email_messages m WHERE m.id = $1 AND m.link_id = $2 AND m.is_draft AND NOT m.is_sent
                AND NOT EXISTS (SELECT 1 FROM email_scheduled_messages WHERE message_id = m.id)
            ON CONFLICT (message_id) DO UPDATE SET delete_requested = true,actor_id = EXCLUDED.actor_id,
                state = 'pending',
                checkpoint = CASE WHEN email_mailbox_drafts.checkpoint->>'stage'='creating' THEN email_mailbox_drafts.checkpoint ELSE NULL END,
                error_code = NULL,lease_id=NULL,lease_until=NULL,
                available_at = now(),updated_at = now()
            RETURNING message_id
        "#,message_id,link.id,link.sync_generation,actor).fetch_optional(&mut *tx).await?;
        if queued.is_none() {
            return Ok(None);
        }
        sqlx::query!("UPDATE email_messages SET mailbox_state = COALESCE(mailbox_state,'{}'::jsonb) || '{\"provider_missing\":true}'::jsonb WHERE id = $1",message_id).execute(&mut *tx).await?;
        super::thread::update_thread_metadata(&mut tx, thread_db_id, link.id).await?;
        let payload = serde_json::json!({"kind":"organization","thread_id":thread_db_id});
        sqlx::query!("INSERT INTO email_projection_outbox (id,link_id,generation,payload) VALUES ($1,$2,$3,$4)",macro_uuid::generate_uuid_v7(),link.id,link.sync_generation,payload).execute(&mut *tx).await?;
        tx.commit().await?;
        return Ok(Some(DraftDeletion {
            thread_deleted: false,
        }));
    }

    let deleted_link_id = sqlx::query_scalar!(
        r#"
        DELETE FROM email_messages
        WHERE id = $1 AND thread_id = $2 AND link_id = ANY($3) AND is_draft = true AND is_sent = false
          AND EXISTS (SELECT 1 FROM email_links l WHERE l.id = email_messages.link_id AND l.provider = 'GMAIL')
          AND NOT EXISTS (SELECT 1 FROM email_scheduled_messages WHERE message_id = $1 AND link_id = email_messages.link_id)
        RETURNING link_id
        "#,
        message_id,
        thread_db_id,
        link_ids,
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(link_id) = deleted_link_id else {
        return Ok(None);
    };

    let messages_remain = sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM email_messages WHERE thread_id = $1) AS "exists!""#,
        thread_db_id
    )
    .fetch_one(&mut *tx)
    .await?;

    if !messages_remain {
        sqlx::query!("DELETE FROM email_threads WHERE id = $1", thread_db_id)
            .execute(&mut *tx)
            .await?;
    } else {
        // Saving the draft inflated the thread's denormalized state — drafts
        // count toward inbox_visible, latest_inbound_message_ts, and
        // is_signal — so a full metadata recompute (which piggybacks the
        // is_signal sync) is needed to put the thread back where it was.
        super::thread::update_thread_metadata(&mut tx, thread_db_id, link_id).await?;
    }

    tx.commit().await?;
    Ok(Some(DraftDeletion {
        thread_deleted: !messages_remain,
    }))
}

/// Upsert or delete a scheduled message based on send_time.
pub(super) async fn process_scheduled_message(
    tx: &mut sqlx::PgConnection,
    link_id: Uuid,
    message_db_id: Uuid,
    send_time: Option<DateTime<Utc>>,
    actor_id: Option<&str>,
) -> Result<(), sqlx::Error> {
    if let Some(send_time) = send_time {
        sqlx::query!(
            r#"
            INSERT INTO email_scheduled_messages (
                link_id, message_id, send_time, sent, actor_id,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (link_id, message_id) DO UPDATE SET
                send_time = EXCLUDED.send_time,
                actor_id = EXCLUDED.actor_id,
                updated_at = NOW()
            WHERE NOT email_scheduled_messages.sent AND NOT email_scheduled_messages.processing
            "#,
            link_id,
            message_db_id,
            send_time,
            false,
            actor_id,
        )
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query!(
            r#"
            DELETE FROM email_scheduled_messages
            WHERE link_id = $1 AND message_id = $2
            "#,
            link_id,
            message_db_id,
        )
        .execute(&mut *tx)
        .await?;
    }
    Ok(())
}

/// Upsert message recipients, removing stale ones and inserting new ones.
pub(super) async fn upsert_recipients(
    tx: &mut sqlx::PgConnection,
    message_db_id: Uuid,
    contacts: &UpsertedContacts,
) -> Result<(), sqlx::Error> {
    if contacts.recipients.is_empty() {
        // Delete all existing recipients when the new list is empty.
        sqlx::query!(
            r#"
            DELETE FROM email_message_recipients
            WHERE message_id = $1
            "#,
            message_db_id,
        )
        .execute(&mut *tx)
        .await?;
        return Ok(());
    }

    let n = contacts.recipients.len();
    let mut message_ids: Vec<Uuid> = Vec::with_capacity(n);
    let mut contact_ids: Vec<Uuid> = Vec::with_capacity(n);
    let mut recipient_names: Vec<Option<String>> = Vec::with_capacity(n);
    let mut recipient_types: Vec<DbRecipientType> = Vec::with_capacity(n);

    for r in &contacts.recipients {
        message_ids.push(message_db_id);
        contact_ids.push(r.contact_id);
        recipient_names.push(r.name.clone());
        recipient_types.push(match r.recipient_type {
            RecipientType::To => DbRecipientType::To,
            RecipientType::Cc => DbRecipientType::Cc,
            RecipientType::Bcc => DbRecipientType::Bcc,
        });
    }

    // Delete stale recipients
    sqlx::query!(
        r#"
        DELETE FROM email_message_recipients
        WHERE message_id = $1
          AND (contact_id, recipient_type) NOT IN (
              SELECT contact_id, recipient_type
              FROM unnest($2::uuid[], $3::email_recipient_type[])
              AS t(contact_id, recipient_type)
          )
        "#,
        message_db_id,
        &contact_ids,
        &recipient_types as &[DbRecipientType],
    )
    .execute(&mut *tx)
    .await?;

    // Insert new recipients
    sqlx::query!(
        r#"
        INSERT INTO email_message_recipients (message_id, contact_id, name, recipient_type)
        SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::email_recipient_type[])
        ON CONFLICT (message_id, contact_id, recipient_type) DO NOTHING
        "#,
        &message_ids,
        &contact_ids,
        &recipient_names as &[Option<String>],
        &recipient_types as &[DbRecipientType],
    )
    .execute(&mut *tx)
    .await?;

    Ok(())
}
