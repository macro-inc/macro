//! Gmail send capability implementation.

use crate::domain::models::{AccessToken, EmailApiError, SendRequest, SentIds};
use crate::domain::ports::MailboxSendClient;

use super::{GmailApiClientRepository, map_gmail_error};

impl MailboxSendClient for GmailApiClientRepository {
    async fn send_message(
        &self,
        access_token: &AccessToken,
        request: &SendRequest,
        provider_thread_id: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        let mime = request.build_mime()?;
        let sent = self
            .client
            .send_message(access_token.expose_secret(), &mime, provider_thread_id)
            .await
            .map_err(map_gmail_error)?;

        Ok(SentIds {
            provider_message_id: sent.id,
            provider_thread_id: sent.thread_id,
        })
    }
}
