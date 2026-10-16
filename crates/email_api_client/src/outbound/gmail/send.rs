//! Gmail send capability implementation.

use crate::domain::models::{AccessToken, EmailApiError, SendRequest, SentIds};
use crate::domain::ports::{MailboxSendClient, MailboxSendRecoveryClient};

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
            .map_err(map_send_error)?;

        Ok(SentIds {
            provider_message_id: sent.id,
            provider_thread_id: sent.thread_id,
        })
    }
}

impl MailboxSendRecoveryClient for GmailApiClientRepository {
    async fn send_prepared(
        &self,
        access_token: &AccessToken,
        mime: &[u8],
        provider_thread_id: Option<&str>,
    ) -> Result<SentIds, EmailApiError> {
        let sent = self
            .client
            .send_message(access_token.expose_secret(), mime, provider_thread_id)
            .await
            .map_err(map_send_error)?;
        Ok(SentIds {
            provider_message_id: sent.id,
            provider_thread_id: sent.thread_id,
        })
    }

    async fn find_sent_message(
        &self,
        access_token: &AccessToken,
        message_id: &str,
    ) -> Result<Option<SentIds>, EmailApiError> {
        self.client
            .find_sent_message(access_token.expose_secret(), message_id)
            .await
            .map(|found| {
                found.map(|sent| SentIds {
                    provider_message_id: sent.id,
                    provider_thread_id: sent.thread_id,
                })
            })
            .map_err(map_gmail_error)
    }
}

/// Preserve an explicit validation refusal separately from a malformed success.
/// A request-timeout response still cannot establish whether delivery occurred.
fn map_send_error(error: gmail_client::GmailApiHttpError) -> EmailApiError {
    let rejected = error
        .status()
        .is_some_and(|status| status.is_client_error() && status.as_u16() != 408);
    match map_gmail_error(error) {
        EmailApiError::Permanent { message } if rejected => EmailApiError::SendRejected { message },
        error => error,
    }
}
