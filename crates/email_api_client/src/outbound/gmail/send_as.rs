//! Gmail send-as capability implementation.

use crate::domain::models::{AccessToken, EmailApiError};
use crate::domain::ports::{MailboxSendAsClient, ProviderSendAsAlias};

use super::{GmailApiClientRepository, map_gmail_error};

impl MailboxSendAsClient for GmailApiClientRepository {
    async fn list_send_as(
        &self,
        access_token: &AccessToken,
    ) -> Result<Vec<ProviderSendAsAlias>, EmailApiError> {
        let aliases = self
            .client
            .list_send_as(access_token.expose_secret())
            .await
            .map_err(map_gmail_error)?;

        Ok(aliases.into_iter().map(convert_send_as).collect())
    }
}

fn convert_send_as(resource: models_email::gmail::send_as::SendAsResource) -> ProviderSendAsAlias {
    ProviderSendAsAlias {
        send_as_email: resource.send_as_email,
        display_name: resource.display_name,
        reply_to_address: resource.reply_to_address,
        signature: resource.signature,
        is_default: resource.is_default,
        is_verified: resource.verification_status.is_verified(),
        is_primary: resource.is_primary,
    }
}
