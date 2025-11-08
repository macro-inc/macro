use crate::api::context::ApiContext;
use crate::service::attachment::document::get_document_plaintext_content;
use ai::types::PromptAttachment;
use anyhow::Context;
use anyhow::Result;
use model::chat::{AttachmentType, ChatAttachmentWithName};
use std::sync::Arc;

#[tracing::instrument(err, skip(ctx))]
pub async fn build_prompt_attachments(
    attachments: Vec<ChatAttachmentWithName>,
    ctx: Arc<ApiContext>,
) -> Result<Vec<PromptAttachment>> {
    let requests =
        attachments
            .into_iter()
            .flat_map(|attachment| match attachment.attachment_type {
                AttachmentType::Document => Some(get_attachment_document(ctx.clone(), attachment)),
                _ => None,
            });
    futures::future::try_join_all(requests).await
}

#[tracing::instrument(err, skip(ctx))]
async fn get_attachment_document(
    ctx: Arc<ApiContext>,
    attachment: ChatAttachmentWithName,
) -> Result<PromptAttachment> {
    let document_content = get_document_plaintext_content(&ctx, &attachment.attachment_id)
        .await
        .context("Failed to get document plaintext content")?;

    let file_type = document_content.file_type;
    let document_name = document_content.metadata().document_name.clone();
    let content = document_content
        .text_content()
        .context("Failed to extract text content from document")?;

    Ok(PromptAttachment {
        id: attachment.attachment_id.clone(),
        file_type: file_type.to_string(),
        name: document_name,
        content,
    })
}
