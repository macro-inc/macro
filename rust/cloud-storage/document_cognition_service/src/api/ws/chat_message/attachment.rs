use crate::api::context::ApiContext;
use crate::core::constants::CHANNEL_TRANSCRIPT_MAX_MESSAGES;
use crate::service::attachment::document::get_document_plaintext_content;
use ai::types::PromptAttachment;
use anyhow::{Context, Error};
use futures::FutureExt;
use futures::future::try_join_all;
use model::chat::{AttachmentMetadata, ChatAttachmentWithName};
use std::sync::Arc;

#[tracing::instrument(err, skip_all, fields(attachment_count = attachments.len()))]
pub async fn get_prompt_attachments(
    ctx: Arc<ApiContext>,
    attachments: Vec<ChatAttachmentWithName>,
) -> Result<Vec<PromptAttachment>, Error> {
    #[expect(clippy::type_complexity, reason = "too annoying to fix now")]
    let mut requests: Vec<
        std::pin::Pin<Box<dyn futures::Future<Output = Result<PromptAttachment, Error>> + Send>>,
    > = Vec::new();

    for att in attachments.into_iter() {
        let ctx = ctx.clone();
        match att.metadata {
            Some(AttachmentMetadata::Document { document_type, .. })
                if document_type.is_text_content() =>
            {
                let attachment_id = att.attachment_id;
                let file_type = document_type.to_string();
                let document_id = attachment_id.clone();
                let document_request = async move {
                    let document_metadata = get_document_plaintext_content(&ctx, &attachment_id)
                        .await
                        .context("failed to get document plaintext content")?;
                    Ok(PromptAttachment {
                        id: document_id,
                        file_type,
                        name: document_metadata.metadata().document_name.clone(),
                        content: document_metadata
                            .text_content()
                            .context("failed to extract text content from document")?,
                    })
                };
                requests.push(document_request.boxed());
            }
            Some(AttachmentMetadata::Channel {
                channel_name,
                channel_type: _,
            }) => {
                let id = att.attachment_id;
                let channel_request = async move {
                    let since = None; // no time limit
                    let limit = Some(CHANNEL_TRANSCRIPT_MAX_MESSAGES);
                    let content = ctx
                        .scribe
                        .channel
                        .get_channel_transcript(id.as_str(), None, since, limit)
                        .await
                        .map_err(|e| {
                            tracing::error!(channel_id = %id, error = %e, "failed to get channel transcript");
                            anyhow::anyhow!("failed to get channel transcript")
                        })?;
                    Ok(PromptAttachment {
                        id,
                        file_type: "channel".to_string(),
                        name: channel_name,
                        content,
                    })
                };
                requests.push(channel_request.boxed());
            }
            _ => {}
        }
    }

    Ok(try_join_all(requests)
        .await
        .context("failed to fetch attachment content")?
        .into_iter()
        .collect())
}
