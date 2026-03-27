use crate::api::context::DcsScribe;
use crate::core::constants::CHANNEL_TRANSCRIPT_MAX_MESSAGES;
use ai::types::{Attachment, ImageData};
use ai_format::document::Document;
use ai_tools::read::EmailMessage;
use macro_user_id::user_id::MacroUserIdStr;
use model::{
    chat::{AttachmentType, ChatAttachmentWithName},
    document::FileTypeExt,
};
use std::sync::Arc;

pub const EMAIL_THREAD_MESSAGE_LIMIT: i64 = 20;
// TODO: @ehayes2000 this needs to return an enumerated error (Not Found | Permission | Internal)
#[tracing::instrument(err, skip(scribe, attachments))]
pub async fn fetchium(
    scribe: Arc<DcsScribe>,
    attachments: Vec<ChatAttachmentWithName>,
    jwt: &str,
    user_id: MacroUserIdStr<'static>,
) -> Result<Vec<Attachment>, anyhow::Error> {
    // --- closure to fetch single attachment ---
    #[tracing::instrument(err, skip(scribe))]
    async fn fetchington(
        attachment: ChatAttachmentWithName,
        scribe: Arc<DcsScribe>,
        jwt: &str,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Attachment, anyhow::Error> {
        match attachment.attachment_type {
            AttachmentType::Project => {
                // fetch id's of stuff in folder
                let project_items = scribe
                    .document
                    .fetch_project(attachment.attachment_id.clone())
                    .content(scribe.document.db(), user_id)
                    .await?
                    .to_string();
                Ok(Attachment::Text(
                    Document {
                        id: attachment.attachment_id.clone(),
                        file_type: "Project".into(),
                        name: attachment.name().unwrap_or_default().into(),
                        content: project_items,
                        properties: None,
                    }
                    .boxed(),
                ))
            }
            AttachmentType::Image => {
                let image = scribe
                    .static_file
                    .fetch(attachment.attachment_id.clone())
                    .file_content()
                    .await?
                    .content;

                Ok(Attachment::Image(ImageData::try_from(image)?))
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

                Ok(Attachment::Text(
                    Document {
                        content: transcript,
                        file_type: "channel".into(),
                        id: attachment.attachment_id.clone(),
                        name: "unknown channel name".into(),
                        properties: None,
                    }
                    .boxed(),
                ))
            }
            AttachmentType::Document => {
                let document = scribe
                    .document
                    .fetch_with_auth(attachment.attachment_id.clone(), jwt.to_string())
                    .document_content()
                    .await?;
                if document.file_type().is_image() {
                    Ok(Attachment::Image(ImageData::try_from(document.content)?))
                } else {
                    document
                        .text_attachment()
                        .ok_or(anyhow::anyhow!("Expected text content found image"))
                        .map(Attachment::Text)
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

                let thread = thread
                    .into_iter()
                    .map(EmailMessage::from)
                    .collect::<Vec<_>>();

                let formatted_content = ai_tools::read::ReadContent::Email {
                    thread_id: attachment.attachment_id.clone(),
                    subject: Some(subject.clone()),
                    messages: thread,
                };

                let content = serde_json::to_string_pretty(&formatted_content)?;

                Ok(Attachment::Text(
                    Document {
                        id: attachment.attachment_id,
                        name: subject.clone(),
                        file_type: "email".to_string(),
                        content,
                        properties: None,
                    }
                    .boxed(),
                ))
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
