//! Adapt the durable draft coordinator to local engine drafts and SMTP admission.

use super::*;
use email::domain::mailbox::drafts::ports::DraftGateway;
use uuid::Uuid;

fn draft(source: models::Draft) -> Result<ProviderDraft, EmailApiError> {
    Ok(ProviderDraft {
        id: ProviderId::new(source.id)?,
        conversation_id: ProviderId::new(source.conversation_id)?,
        version: Some(source.version),
        is_draft: source.is_draft,
        app_revision: Some(source.app_revision),
        content_fingerprint: Some(source.content_fingerprint),
    })
}
fn input(request: &DraftRequest) -> Result<models::DraftInput, EmailApiError> {
    Ok(models::DraftInput {
        correlation: request.correlation,
        revision: request.revision,
        reply_to: request.reply_to.as_ref().map(|id| id.as_str().to_owned()),
        content: serde_json::to_value(&request.content).map_err(|_| EmailApiError::Permanent {
            message: "invalid IMAP draft content".into(),
        })?,
    })
}
fn attachment(source: models::DraftAttachment) -> Result<DraftAttachment, EmailApiError> {
    Ok(DraftAttachment {
        id: ProviderId::new(source.id)?,
        name: source.name,
        size: source.size,
        content_id: source.content_id,
        inline: source.inline,
    })
}
fn attachment_input(content: AttachmentContent<'_>) -> models::AttachmentInput {
    models::AttachmentInput {
        name: content.name.into(),
        content_type: content.content_type.into(),
        content_id: content.content_id.into(),
        inline: content.inline,
        data_base64: STANDARD.encode(content.data),
    }
}
fn upload(mailbox: MailboxKey, session: models::UploadSession) -> AttachmentUploadSession {
    // A local capability encodes both the owning link and engine upload id.
    // The adapter parses it; it is never fetched as a user-supplied HTTP URL.
    AttachmentUploadSession {
        url: UploadUrl::new(format!("imap-upload:{}/{}", mailbox.link_id, session.id)),
        expires_at: session.expires_at,
        next_offset: session.next_offset,
    }
}
fn upload_id(mailbox: MailboxKey, url: &UploadUrl) -> Result<Uuid, EmailApiError> {
    let value = url
        .expose()
        .strip_prefix("imap-upload:")
        .ok_or(EmailApiError::Forbidden)?;
    let (link, id) = value.split_once('/').ok_or(EmailApiError::Forbidden)?;
    if Uuid::parse_str(link).ok() != Some(mailbox.link_id) {
        return Err(EmailApiError::Forbidden);
    }
    Uuid::parse_str(id).map_err(|_| EmailApiError::Forbidden)
}
impl DraftGateway for ImapMailboxGateway {
    async fn get_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<Option<ProviderDraft>, EmailApiError> {
        let result = self.client.get_draft(binding(mailbox), id.as_str()).await;
        self.record(mailbox, result).await?.map(draft).transpose()
    }
    async fn find_drafts(
        &self,
        mailbox: MailboxKey,
        id: Uuid,
    ) -> Result<Vec<ProviderDraft>, EmailApiError> {
        let result = self.client.find_drafts(binding(mailbox), id).await;
        self.record(mailbox, result)
            .await?
            .into_iter()
            .map(draft)
            .collect()
    }
    async fn create_draft(
        &self,
        mailbox: MailboxKey,
        request: &DraftRequest,
    ) -> Result<ProviderDraft, EmailApiError> {
        let result = self
            .client
            .create_draft(binding(mailbox), input(request)?)
            .await;
        draft(self.record(mailbox, result).await?)
    }
    async fn update_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        request: &DraftRequest,
        version: &str,
    ) -> Result<ProviderDraft, EmailApiError> {
        let result = self
            .client
            .update_draft(binding(mailbox), id.as_str(), input(request)?, version)
            .await;
        draft(self.record(mailbox, result).await?)
    }
    async fn delete_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        version: &str,
    ) -> Result<(), EmailApiError> {
        let result = self
            .client
            .delete_draft(binding(mailbox), id.as_str(), version)
            .await;
        self.record(mailbox, result).await
    }
    async fn attachments(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<Vec<DraftAttachment>, EmailApiError> {
        let result = self.client.attachments(binding(mailbox), id.as_str()).await;
        self.record(mailbox, result)
            .await?
            .into_iter()
            .map(attachment)
            .collect()
    }
    async fn add_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> Result<DraftAttachment, EmailApiError> {
        let result = self
            .client
            .add_attachment(binding(mailbox), id.as_str(), attachment_input(content))
            .await;
        attachment(self.record(mailbox, result).await?)
    }
    async fn delete_attachment(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        attachment: &ProviderId,
    ) -> Result<(), EmailApiError> {
        let result = self
            .client
            .delete_attachment(binding(mailbox), id.as_str(), attachment.as_str())
            .await;
        self.record(mailbox, result).await
    }
    async fn create_upload(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        content: AttachmentContent<'_>,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        let mut content = attachment_input(content);
        content.data_base64.clear();
        let result = self
            .client
            .create_upload(binding(mailbox), id.as_str(), content)
            .await;
        Ok(upload(mailbox, self.record(mailbox, result).await?))
    }
    async fn inspect_upload(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
    ) -> Result<AttachmentUploadSession, EmailApiError> {
        let result = self
            .client
            .inspect_upload(binding(mailbox), upload_id(mailbox, url)?)
            .await;
        Ok(upload(mailbox, self.record(mailbox, result).await?))
    }
    async fn upload_range(
        &self,
        mailbox: MailboxKey,
        url: &UploadUrl,
        offset: u64,
        total: u64,
        bytes: &[u8],
    ) -> Result<UploadProgress, EmailApiError> {
        let result = self
            .client
            .upload_range(
                binding(mailbox),
                upload_id(mailbox, url)?,
                offset,
                total,
                bytes,
            )
            .await;
        let session = self.record(mailbox, result).await?;
        Ok(if session.attachment.is_some() {
            UploadProgress::Complete
        } else {
            UploadProgress::Continue(upload(mailbox, session))
        })
    }
    async fn submit_draft(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
    ) -> Result<SubmissionOutcome, EmailApiError> {
        let result = self.client.submit(binding(mailbox), id.as_str()).await;
        Ok(match self.record(mailbox, result).await? {
            models::SubmissionOutcome::Accepted => SubmissionOutcome::Accepted,
            models::SubmissionOutcome::Unknown => SubmissionOutcome::Unknown,
            models::SubmissionOutcome::Rejected { refusal } => {
                return Err(EmailApiError::SendRejected {
                    reason: SendRejectionReason::ProviderRejected,
                    refusal: Some(refusal),
                    message: "SMTP server refused submission before the message body".into(),
                });
            }
        })
    }
}

#[cfg(test)]
mod test;
