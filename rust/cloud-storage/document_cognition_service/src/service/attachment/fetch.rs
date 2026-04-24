use crate::api::context::DcsScribe;
use crate::core::constants::CHANNEL_TRANSCRIPT_MAX_MESSAGES;
use attachment::image::ImageData;
use chat::domain::models::{ImageContent, ResolvedMessagePart};
use macro_user_id::user_id::MacroUserIdStr;
use model::{
    chat::{AttachmentType, ChatAttachmentWithName},
    document::FileTypeExt,
};
use std::sync::Arc;

pub const EMAIL_THREAD_MESSAGE_LIMIT: i64 = 20;

#[tracing::instrument(err, skip(scribe, attachments))]
pub async fn fetchium(
    scribe: Arc<DcsScribe>,
    attachments: Vec<ChatAttachmentWithName>,
    jwt: &str,
    user_id: MacroUserIdStr<'static>,
) -> Result<Vec<ResolvedMessagePart>, anyhow::Error> {
    #[tracing::instrument(err, skip(scribe))]
    async fn fetchington(
        attachment: ChatAttachmentWithName,
        scribe: Arc<DcsScribe>,
        jwt: &str,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<ResolvedMessagePart, anyhow::Error> {
        let name = attachment.name().unwrap_or_default().to_string();

        match attachment.attachment_type {
            AttachmentType::Project => {
                let project_items = scribe
                    .document
                    .fetch_project(attachment.attachment_id.clone())
                    .content(scribe.document.db(), user_id)
                    .await?
                    .to_string();
                Ok(ResolvedMessagePart::Attachment {
                    name,
                    parts: vec![ResolvedMessagePart::Text {
                        content: project_items,
                    }],
                })
            }
            AttachmentType::Image => {
                let file = scribe
                    .static_file
                    .fetch(attachment.attachment_id.clone())
                    .file_content()
                    .await?
                    .content;

                let data = ImageData::try_from(file)?;
                Ok(ResolvedMessagePart::Image(image_data_to_content(data)))
            }
            AttachmentType::Channel => {
                let transcript = scribe
                    .channel
                    .get_channel_transcript(
                        attachment.attachment_id.as_str(),
                        None,
                        Some(CHANNEL_TRANSCRIPT_MAX_MESSAGES),
                    )
                    .await?;

                Ok(ResolvedMessagePart::Attachment {
                    name,
                    parts: vec![ResolvedMessagePart::Text {
                        content: transcript,
                    }],
                })
            }
            AttachmentType::Document => {
                let document = scribe
                    .document
                    .fetch_with_auth(attachment.attachment_id.clone(), jwt.to_string())
                    .document_content()
                    .await?;
                if document.file_type().is_image() {
                    let data = ImageData::try_from(document.content)?;
                    Ok(ResolvedMessagePart::Image(image_data_to_content(data)))
                } else {
                    let doc_name = document.location.metadata().document_name.clone();
                    let text = document.content.text_content().unwrap_or_default();
                    Ok(ResolvedMessagePart::Attachment {
                        name: doc_name,
                        parts: vec![ResolvedMessagePart::Text { content: text }],
                    })
                }
            }
            AttachmentType::Email => {
                let thread = scribe
                    .email
                    .get_email_messages_by_thread_id(
                        &attachment.attachment_id,
                        0,
                        EMAIL_THREAD_MESSAGE_LIMIT,
                    )
                    .await?;

                let subject = thread
                    .first()
                    .and_then(|first| first.subject.as_deref())
                    .unwrap_or("No Subject")
                    .to_string();

                let content = thread
                    .iter()
                    .map(serde_json::to_string_pretty)
                    .collect::<Result<Vec<_>, _>>()?
                    .join("\n");

                Ok(ResolvedMessagePart::Attachment {
                    name: subject,
                    parts: vec![ResolvedMessagePart::Text { content }],
                })
            }
        }
    }

    let futures = attachments
        .into_iter()
        .map(|attachment| fetchington(attachment, scribe.clone(), jwt, user_id.clone()));

    let results = futures::future::try_join_all(futures).await.inspect_err(
        |err| tracing::error!(error=?err, "failed to fetch one or more attachments"),
    )?;
    Ok(results)
}

fn image_data_to_content(data: ImageData) -> ImageContent {
    match data {
        ImageData::StaticUrl(url) => ImageContent::StaticUrl { url },
        ImageData::Base64(b64) => ImageContent::Base64 {
            data: b64.to_string(),
        },
    }
}
