use anyhow::Context;
use email::domain::attachment_access::AuthorizedAttachmentBytes;
use futures::{StreamExt, TryStreamExt};
use models_email::service::attachment::{AttachmentDraft, AttachmentToSend};
use models_email::service::link::Link;
use models_email::service::message;
use sqlx::PgPool;
use uuid::Uuid;

/// Generate email headers that are used for threading
pub async fn generate_email_threading_headers(
    db: &PgPool,
    replying_to_db_id: Option<Uuid>,
    link_id: Uuid,
) -> (Option<String>, Option<Vec<String>>) {
    if let Some(replying_to_db_id) = replying_to_db_id {
        // Fetch headers from the parent message
        let (parent_id_header, parent_references_header) =
            email_db_client::messages::get::get_message_threading_headers(
                db,
                replying_to_db_id,
                link_id,
            )
                .await
                .unwrap_or_else(|e| {
                    tracing::warn!(error=?e, replying_to_db_id=?replying_to_db_id, "Unable to fetch threading headers for parent message");
                    (None, None) // Default to None on error
                });

        // Clean references header
        let mut references_list: Vec<String> = parent_references_header
            .map(|refs_str| {
                refs_str
                    .replace(['<', '>'], "")
                    .split_whitespace()
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default();

        // The message we are replying to will always be the last id in the References header
        if let Some(id) = &parent_id_header {
            references_list.push(id.clone());
        }

        let final_references = if references_list.is_empty() {
            None
        } else {
            Some(references_list)
        };

        (parent_id_header, final_references)
    } else {
        // If there is no message to reply to
        (None, None)
    }
}

/// Fetch any attachments the user previously added to the draft from s3 and attach them to the message
/// being sent. Return the attachment metadata so we can use it to delete the attachments from s3
/// after the message is sent.
#[tracing::instrument(
    skip(db, s3_client, message_to_send),
    fields(message_db_id = ?message_to_send.db_id)
)]
pub async fn fetch_and_attach_draft_attachments(
    db: &sqlx::PgPool,
    s3_client: &s3_client::S3,
    bucket: &str,
    link: &Link,
    message_to_send: &mut message::MessageToSend,
) -> anyhow::Result<Option<Vec<AttachmentDraft>>> {
    if let Some(db_id) = message_to_send.db_id {
        let db_attachments =
            email_db_client::attachments::draft::fetch_draft_attachments_by_draft_id(
                db, link.id, db_id,
            )
            .await
            .context("unable to fetch draft attachments from database")?;

        if !db_attachments.is_empty() {
            let fetch_futures = db_attachments.iter().map(|db_attachment| async move {
                anyhow::ensure!(
                    !db_attachment.upload_pending,
                    "Attachment upload is unfinished"
                );
                let attachment_data = s3_client
                    .get(bucket, &db_attachment.s3_key)
                    .await
                    .with_context(|| {
                        format!(
                            "Failed to fetch attachment from S3 (key: {})",
                            db_attachment.s3_key
                        )
                    })?;

                Ok::<AttachmentToSend, anyhow::Error>(AttachmentToSend {
                    content_id: db_attachment.content_id.clone(),
                    is_inline: db_attachment.is_inline,
                    file_name: db_attachment.file_name.clone(),
                    content_type: db_attachment.content_type.clone(),
                    data: attachment_data,
                })
            });

            let attachments_to_send = futures::future::try_join_all(fetch_futures).await?;

            message_to_send.attachments = Some(attachments_to_send);
            return Ok(Some(db_attachments));
        }
    }
    Ok(None)
}

/// Resolve forwarded and imported-draft files with their source inbox credentials and current actor access.
#[tracing::instrument(
    skip(db, reader, actor, message_to_send),
    fields(message_db_id = ?message_to_send.db_id), err
)]
pub async fn fetch_and_attach_forwarded_attachments(
    db: &PgPool,
    reader: &dyn AuthorizedAttachmentBytes,
    actor: &str,
    link: &Link,
    message_to_send: &mut message::MessageToSend,
) -> anyhow::Result<()> {
    let Some(db_id) = message_to_send.db_id else {
        return Ok(());
    };

    // Include native attachments on imported drafts, while deduplicating the
    // provider copies of Macro uploads/forwarded files and honoring removals.
    let attachment_ids=sqlx::query_scalar!(r#"SELECT a.id AS "id!" FROM email_attachments a
        JOIN email_messages m ON m.id=a.message_id WHERE m.id=$1 AND m.link_id=$2
        AND NOT EXISTS(SELECT 1 FROM email_draft_attachment_removals r WHERE r.message_id=m.id AND (r.provider_id=a.provider_attachment_id OR trim(both '<>' from r.content_id)=trim(both '<>' from a.content_id)))
        AND NOT EXISTS(SELECT 1 FROM email_attachments_drafts u WHERE u.draft_id=m.id AND trim(both '<>' from a.content_id)=COALESCE(trim(both '<>' from u.content_id),u.id::text||'@attachments.macro.com'))
        AND NOT EXISTS(SELECT 1 FROM email_attachments_fwd f JOIN email_attachments original ON original.id=f.attachment_id WHERE f.message_id=m.id AND (trim(both '<>' from a.content_id)=trim(both '<>' from original.content_id) OR trim(both '<>' from a.content_id)=f.attachment_id::text||'@attachments.macro.com'))
        UNION SELECT f.attachment_id FROM email_attachments_fwd f JOIN email_messages m ON m.id=f.message_id WHERE m.id=$1 AND m.link_id=$2"#,db_id,link.id).fetch_all(db).await?;
    if attachment_ids.is_empty() {
        return Ok(());
    }

    let html = message_to_send.body_html.as_deref();
    let forwarded_to_send =
        futures::stream::iter(attachment_ids.into_iter().map(|attachment_id| async move {
            let (record, data) = reader.read(actor, attachment_id).await?;
            let content_id = record
                .attachment
                .content_id
                .map(|cid| cid.trim_matches(['<', '>']).to_owned());
            let is_inline = content_id
                .as_deref()
                .is_some_and(|cid| html.is_some_and(|body| body.contains(&format!("cid:{cid}"))));
            Ok::<AttachmentToSend, anyhow::Error>(AttachmentToSend {
                content_id,
                is_inline,
                file_name: record
                    .attachment
                    .filename
                    .unwrap_or_else(|| "attachment".into()),
                content_type: record
                    .attachment
                    .mime_type
                    .unwrap_or_else(|| "application/octet-stream".into()),
                data,
            })
        }))
        .buffered(4)
        .try_collect::<Vec<_>>()
        .await?;

    let total = message_to_send
        .attachments
        .as_ref()
        .into_iter()
        .flatten()
        .chain(forwarded_to_send.iter())
        .map(|file| file.data.len())
        .sum::<usize>();
    anyhow::ensure!(
        total <= 18_000_000,
        "Combined attachment size exceeds Gmail's upload limit"
    );
    match &mut message_to_send.attachments {
        Some(existing) => existing.extend(forwarded_to_send),
        None => message_to_send.attachments = Some(forwarded_to_send),
    }

    Ok(())
}

/// Release upload references; the shared cleanup worker preserves every remaining draft or blob reference.
#[tracing::instrument(skip_all)]
pub async fn cleanup_draft_attachments(
    db: sqlx::PgPool,
    link_id: Uuid,
    draft_id: Uuid,
    attachments: Vec<AttachmentDraft>,
) {
    let result: anyhow::Result<()> = async {
        let mut tx=db.begin().await?;
        for attachment in attachments {
            sqlx::query!("INSERT INTO email_draft_object_cleanup(object_key,available_at) VALUES($1,now()+interval '1 day') ON CONFLICT DO NOTHING",attachment.s3_key).execute(&mut *tx).await?;
            email_db_client::attachments::draft::delete_draft_attachment(&mut *tx,link_id,draft_id,attachment.id).await?;
        }
        tx.commit().await?;
        Ok(())
    }.await;
    if let Err(error) = result {
        tracing::error!(?error, "Failed to release sent draft attachment references");
    }
}

#[cfg(test)]
mod test;
