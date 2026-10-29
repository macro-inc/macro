/// Frozen attachment metadata and payload preparation for delivery.
pub mod attachment_snapshot;

use models_email::service::attachment::AttachmentDraft;
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
            sqlx::query!("DELETE FROM email_attachments_drafts WHERE id=$1 AND draft_id=$2 AND EXISTS(SELECT 1 FROM email_messages WHERE id=$2 AND link_id=$3)",attachment.id,draft_id,link_id).execute(&mut *tx).await?;
        }
        tx.commit().await?;
        Ok(())
    }.await;
    if let Err(error) = result {
        tracing::error!(?error, "Failed to release sent draft attachment references");
    }
}
