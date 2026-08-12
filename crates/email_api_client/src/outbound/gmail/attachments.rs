//! Gmail attachment capability implementation.

use crate::domain::models::{AccessToken, EmailApiError};
use crate::domain::ports::MailboxAttachmentClient;

use super::{GmailApiClientRepository, map_gmail_error};

impl MailboxAttachmentClient for GmailApiClientRepository {
    async fn get_attachment(
        &self,
        access_token: &AccessToken,
        provider_message_id: &str,
        provider_attachment_id: &str,
    ) -> Result<Vec<u8>, EmailApiError> {
        self.client
            .get_attachment_data(
                access_token.expose_secret(),
                provider_message_id,
                provider_attachment_id,
            )
            .await
            .map_err(map_gmail_error)
    }
}
