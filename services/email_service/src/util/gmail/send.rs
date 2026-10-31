/// Frozen attachment metadata and payload preparation for delivery.
pub mod attachment_snapshot;

use email::domain::scheduled_delivery::ReplyOrderError;
use email_db_client::messages::get::ReplyParentDelivery;
use models_email::service::attachment::AttachmentDraft;
use sqlx::PgPool;
use uuid::Uuid;

/// How a scheduled message threads under the message it replies to.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ReplyThreading {
    /// In-Reply-To: the parent's Message-ID.
    pub parent_message_id: Option<String>,
    /// References: the parent's References followed by its Message-ID.
    pub references: Option<Vec<String>>,
    /// The parent's provider thread, for a reply drafted before the parent was
    /// sent (a sequence step), which has no provider thread of its own.
    pub provider_thread_id: Option<String>,
}

/// Resolve threading for a reply about to be delivered from `link_id`.
///
/// A sequence step's reply can't go out before it: the inner result is
/// [`ReplyOrderError`] while the step is still to be sent (defer) or won't be
/// sent (fail). Any other parent threads the reply under the headers it has; a
/// parent that is gone or in another inbox leaves the reply unthreaded.
pub async fn reply_threading(
    db: &PgPool,
    replying_to_db_id: Option<Uuid>,
    link_id: Uuid,
) -> anyhow::Result<Result<ReplyThreading, ReplyOrderError>> {
    let Some(replying_to_db_id) = replying_to_db_id else {
        return Ok(Ok(ReplyThreading::default()));
    };
    let Some(parent) =
        email_db_client::messages::get::get_reply_parent(db, replying_to_db_id, link_id).await?
    else {
        return Ok(Ok(ReplyThreading::default()));
    };
    match parent.delivery {
        ReplyParentDelivery::Unrestricted => {}
        ReplyParentDelivery::Pending => return Ok(Err(ReplyOrderError::ParentPending)),
        ReplyParentDelivery::Unsent => return Ok(Err(ReplyOrderError::ParentUnsent)),
    }

    // A parent Macro sent may not be synced yet; its delivery minted the Message-ID.
    let parent_message_id = parent.message_id_header.or(parent.delivery_message_id);
    let mut references: Vec<String> = parent
        .references_header
        .map(|refs| {
            refs.replace(['<', '>'], "")
                .split_whitespace()
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    // The message we are replying to is always the last id in References.
    if let Some(id) = &parent_message_id {
        references.push(id.clone());
    }

    Ok(Ok(ReplyThreading {
        parent_message_id,
        references: (!references.is_empty()).then_some(references),
        provider_thread_id: parent.provider_thread_id,
    }))
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

#[cfg(test)]
mod test;
