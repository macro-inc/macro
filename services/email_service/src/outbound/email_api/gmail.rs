//! Gmail attachment access through the composed API gateway.
use super::{EmailServiceTokenSource, RedisGmailRequestGate};
use email_api_client::GmailApiClientRepository;
use email_api_client::domain::service::EmailApiClientServiceImpl;

/// Gmail API service composed with email-service infrastructure adapters.
pub type GmailApi = EmailApiClientServiceImpl<
    GmailApiClientRepository,
    EmailServiceTokenSource,
    RedisGmailRequestGate,
>;

pub struct GmailAttachmentGateway(pub GmailApi);

impl email::domain::mailbox::projection::MailboxAttachmentAccess for GmailAttachmentGateway {
    async fn download(
        &self,
        provider: models_email::service::link::UserProvider,
        mailbox: email::domain::mailbox::MailboxKey,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<Vec<u8>, email::domain::mailbox::MailboxError> {
        if provider != models_email::service::link::UserProvider::Gmail {
            return Err(email::domain::mailbox::MailboxError::Stale);
        }
        self.0
            .get_attachment(mailbox.link_id, message_id, attachment_id)
            .await
            .map_err(email::domain::mailbox::MailboxError::Provider)
    }
}
