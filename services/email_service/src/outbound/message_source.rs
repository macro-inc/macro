//! Provider downloads of a message's original RFC 822 source.
use super::email_api::GmailApi;
use email::domain::{
    draft_attachments::AttachmentError,
    message_source::{MessageSourceBytes, MessageSourceRecord},
};
use email_api_client::domain::{
    models::{EmailApiError, MailboxAccess, ProviderId},
    ports::{
        MailboxContentReader, MailboxTokenSource, ProviderRateLimiter, ScopedMailboxRepository,
    },
    service::mailbox::MailboxApiService,
};
use models_email::service::link::UserProvider;

pub struct ProviderMessageSource<R, T, L> {
    pub gmail: GmailApi,
    pub outlook: MailboxApiService<R, T, L>,
}
impl<R, T, L> MessageSourceBytes for ProviderMessageSource<R, T, L>
where
    R: MailboxContentReader + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
{
    async fn bytes(&self, record: &MessageSourceRecord) -> Result<Vec<u8>, AttachmentError> {
        match record.link.provider {
            UserProvider::Gmail => self
                .gmail
                .get_raw_message(record.link.id, &record.message_provider_id)
                .await
                .map_err(provider_error),
            UserProvider::Outlook => {
                let message = ProviderId::new(record.message_provider_id.clone())
                    .map_err(|_| AttachmentError::NotFound)?;
                self.outlook
                    .mime(
                        MailboxAccess {
                            link_id: record.mailbox.link_id,
                            sync_generation: record.mailbox.sync_generation,
                            grant_generation: record.mailbox.grant_generation,
                        },
                        &message,
                    )
                    .await
                    .map_err(provider_error)
            }
        }
    }
}
fn provider_error(error: EmailApiError) -> AttachmentError {
    match error {
        EmailApiError::NotFound => AttachmentError::NotFound,
        EmailApiError::AuthRequired => AttachmentError::Reauthorization,
        EmailApiError::Forbidden => AttachmentError::Forbidden,
        EmailApiError::RateLimited { .. } => AttachmentError::RateLimited,
        _ => AttachmentError::Infrastructure,
    }
}
