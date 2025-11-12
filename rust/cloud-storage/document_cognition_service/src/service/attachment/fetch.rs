use crate::api::context::DcsScribe;
use crate::core::constants::CHANNEL_TRANSCRIPT_MAX_MESSAGES;
use ai::types::{Attachment, PromptAttachment};
use ai_tools::read::EmailMessage;
use anyhow::Context;
use model::chat::{AttachmentType, ChatAttachmentWithName};
use std::sync::Arc;

pub const EMAIL_THREAD_MESSAGE_LIMIT: i64 = 20;
// TODO: @ehayes2000 this needs to return an enumerated error (Not Found | Permission | Internal)
#[tracing::instrument(err, skip(scribe, attachments))]
pub async fn fetchium(
    scribe: Arc<DcsScribe>,
    attachments: Vec<ChatAttachmentWithName>,
) -> Result<Vec<Attachment>, anyhow::Error> {
    // --- closure to fetch single attachment ---
    #[tracing::instrument(err, skip(scribe))]
    async fn fetchington(
        attachment: ChatAttachmentWithName,
        scribe: Arc<DcsScribe>,
    ) -> Result<Attachment, anyhow::Error> {
        match attachment.attachment_type {
            AttachmentType::Image => {
                let base64_image = scribe
                    .static_file
                    .fetch(attachment.attachment_id.clone())
                    .file_content()
                    .await
                    .context("failed to fetch image content")?
                    .content
                    .base64_image_content()?;

                Ok(Attachment::ImageUrl(base64_image))
            }
            AttachmentType::Channel => {
                let transcript = scribe
                    .channel
                    .get_channel_transcript(
                        attachment.attachment_id.as_str(),
                        None,
                        None,
                        Some(CHANNEL_TRANSCRIPT_MAX_MESSAGES),
                    )
                    .await
                    .context("failed to fetch channel transcript")?;

                Ok(Attachment::Text(PromptAttachment {
                    content: transcript,
                    file_type: "channel".into(),
                    id: attachment.attachment_id.clone(),
                    name: "unknown channel name".into(),
                }))
            }
            AttachmentType::Document => {
                let document = scribe
                    .document
                    .fetch(attachment.attachment_id.clone())
                    .document_content()
                    .await
                    .context("failed to fetch document content")?;
                if document.file_type().is_image() {
                    Ok(Attachment::ImageUrl(
                        document.content.base64_image_content()?,
                    ))
                } else {
                    Ok(Attachment::Text(PromptAttachment {
                        id: attachment.attachment_id,
                        name: document.metadata().document_name.clone(),
                        file_type: document.file_type().to_string(),
                        content: document.content.text_content()?,
                    }))
                }
            }
            AttachmentType::Email => {
                let thread = scribe
                    .email
                    .get_email_messages_by_thread_id(
                        &attachment.attachment_id,
                        0,
                        EMAIL_THREAD_MESSAGE_LIMIT,
                        None,
                    )
                    .await
                    .context("failed to fetch email message")?;

                let subject = thread
                    .first()
                    .and_then(|first| first.subject.as_deref())
                    .unwrap_or("No Subject")
                    .to_string();

                let thread = thread
                    .into_iter()
                    .map(EmailMessage::from)
                    .collect::<Vec<_>>();

                let formatted_content = ai_tools::read::ReadContent::Email {
                    thread_id: attachment.attachment_id.clone(),
                    subject: Some(subject.clone()),
                    messages: thread,
                };

                let content = serde_json::to_string_pretty(&formatted_content)
                    .context("error stringifying json")?;

                Ok(Attachment::Text(PromptAttachment {
                    id: attachment.attachment_id,
                    name: subject.clone(),
                    file_type: "email".to_string(),
                    content,
                }))
            }
        }
    }
    //--- end closure --

    let handles = attachments.into_iter().map(|attachment| {
        let scribe = scribe.clone();
        tokio::spawn(async move { fetchington(attachment, scribe).await })
    });

    let results = futures::future::try_join_all(handles)
        .await
        .context("failed to join attachment fetch tasks")?;

    if results.iter().any(Result::is_err) {
        let errors: Vec<_> = results.iter().filter_map(|r| r.as_ref().err()).collect();
        tracing::error!(
            error_count = errors.len(),
            "failed to fetch one or more attachments"
        );
        Err(anyhow::anyhow!("failed to get one or more attachments"))
    } else {
        Ok(results.into_iter().flatten().collect())
    }
}
