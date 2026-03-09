use crate::domain::{
    models::{
        AttachmentDraft, AttachmentForwarded, ContactInfo, MessageAttachment, MessageLabel,
        RecipientType, SimpleMessageInfo, UpsertedContacts,
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
            ml.message_id,
            l.id,
            l.link_id,
            l.provider_label_id,
            l.name,
            l.created_at,
            l.message_list_visibility as "message_list_visibility: _",
            l.label_list_visibility as "label_list_visibility: _",
            l.type as "type_: _"
        FROM email_message_labels ml
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
            ea.content_id
        FROM email_attachments ea
        LEFT JOIN email_attachments_sfs eas ON ea.id = eas.attachment_id
        WHERE ea.message_id = ANY($1)
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
        SELECT id, draft_id, file_name, content_type, sha, size, s3_key
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

/// Fetch a simplified message by DB ID and link ID for validation.
#[tracing::instrument(skip(pool), err)]
pub(crate) async fn get_simple_message(
    pool: &PgPool,
    message_id: Uuid,
    link_id: Uuid,
) -> Result<Option<SimpleMessageInfo>, sqlx::Error> {
    let row = sqlx::query_as!(
        DbSimpleMessageRow,
        r#"
        SELECT
            m.id,
            m.thread_id,
            m.provider_thread_id,
            m.headers_jsonb,
            m.is_sent,
            m.is_draft
        FROM email_messages m
        WHERE m.id = $1 AND m.link_id = $2
        "#,
        message_id,
        link_id,
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
            m.id,
            m.thread_id,
            m.provider_thread_id,
            m.headers_jsonb,
            m.is_sent,
            m.is_draft
        FROM email_messages m
        WHERE m.link_id = $1
          AND m.is_draft = true
          AND jsonb_path_exists(
              m.headers_jsonb,
              '$[*] ? (@."Macro-In-Reply-To" == $macro_uuid)'::jsonpath,
              jsonb_build_object('macro_uuid', $2::text)
          )
        ORDER BY m.created_at DESC
        LIMIT 1
        "#,
        link_id,
        replying_to_id.to_string(),
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(SimpleMessageInfo::from))
}

/// Upsert or delete a scheduled message based on send_time.
pub(super) async fn process_scheduled_message(
    tx: &mut sqlx::PgConnection,
    link_id: Uuid,
    message_db_id: Uuid,
    send_time: Option<DateTime<Utc>>,
) -> Result<(), sqlx::Error> {
    if let Some(send_time) = send_time {
        sqlx::query!(
            r#"
            INSERT INTO email_scheduled_messages (
                link_id, message_id, send_time, sent,
                created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (link_id, message_id) DO UPDATE SET
                send_time = EXCLUDED.send_time,
                sent = EXCLUDED.sent,
                updated_at = NOW()
            "#,
            link_id,
            message_db_id,
            send_time,
            false,
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
