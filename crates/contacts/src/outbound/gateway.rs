use crate::domain::ports::ContactsNotifier;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

/// Notifier that sends invalidation messages through the connection gateway.
pub struct ConnectionGatewayNotifier {
    url: String,
    client: reqwest::Client,
}

impl ConnectionGatewayNotifier {
    /// Creates a new notifier with the given gateway URL and internal auth key.
    pub fn new(internal_auth_key: String, url: String) -> Result<Self, Report> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-internal-auth-key", internal_auth_key.parse()?);
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()?;
        Ok(Self { url, client })
    }

    #[tracing::instrument(skip(self), err)]
    async fn invalidate_contacts(&self, user_id: &str) -> Result<(), Report> {
        self.client
            .post(format!("{}/message/send/user/{}", self.url, user_id))
            .json(&serde_json::json!({"message_type": "contacts_invalidation", "message": {}}))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
}

impl ContactsNotifier for ConnectionGatewayNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        user_ids: Vec<MacroUserIdStr<'_>>,
    ) -> Result<(), Report> {
        for user_id in user_ids {
            self.invalidate_contacts(user_id.as_ref() as &str)
                .await
                .inspect_err(|e| {
                    tracing::error!(user_id = %user_id.as_ref(), error = ?e, "Failed to invalidate contacts")
                })
                .ok();
        }
        Ok(())
    }
}

/// Implements [`ContactsNotifier`] for `Option<ConnectionGatewayNotifier>`,
/// acting as a no-op when `None`.
impl ContactsNotifier for Option<ConnectionGatewayNotifier> {
    async fn invalidate_contacts_for_users(
        &self,
        user_ids: Vec<MacroUserIdStr<'_>>,
    ) -> Result<(), Report> {
        if let Some(notifier) = self {
            notifier.invalidate_contacts_for_users(user_ids).await?;
        }
        Ok(())
    }
}
