use std::sync::Arc;

use crate::domain::{models::EmailErr, ports::GmailLabelModifier};

/// Adapter implementing [`GmailLabelModifier`] via the Gmail API client.
#[derive(Clone)]
pub struct GmailClientLabelModifier {
    gmail_client: Arc<gmail_client::GmailClient>,
}

impl GmailClientLabelModifier {
    /// Create a new modifier wrapping the given Gmail client.
    pub fn new(gmail_client: Arc<gmail_client::GmailClient>) -> Self {
        Self { gmail_client }
    }
}

impl GmailLabelModifier for GmailClientLabelModifier {
    async fn modify_message_labels(
        &self,
        access_token: &str,
        provider_message_id: &str,
        label_ids_to_add: &[String],
        label_ids_to_remove: &[String],
    ) -> Result<(), EmailErr> {
        self.gmail_client
            .modify_message_labels(
                access_token,
                provider_message_id,
                label_ids_to_add,
                label_ids_to_remove,
            )
            .await
            .map_err(EmailErr::ProviderErr)
    }
}
