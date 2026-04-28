use crate::domain::ports::ContactsNotifier;
use macro_user_id::user_id::MacroUserIdStr;

/// Notifier that sends invalidation messages through the connection gateway.
pub struct ConnectionGatewayNotifier {
    url: String,
    client: reqwest::Client,
}

impl ConnectionGatewayNotifier {
    /// Creates a new notifier with the given gateway URL and internal auth key.
    pub fn new(internal_auth_key: String, url: String) -> anyhow::Result<Self> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "x-internal-auth-key",
            internal_auth_key.parse()?,
        );
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()?;
        Ok(Self { url, client })
    }

    #[tracing::instrument(skip(self), err)]
    async fn invalidate_contacts(&self, user_id: &str) -> anyhow::Result<()> {
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
    async fn invalidate_contacts_for_users(&self, user_ids: &[MacroUserIdStr<'static>]) -> anyhow::Result<()> {
        for user_id in user_ids {
            self.invalidate_contacts(user_id.as_ref() as &str)
                .await
                .inspect_err(|e| tracing::error!(user_id = %user_id.as_ref(), error = ?e, "Failed to invalidate contacts"))
                .ok();
        }
        Ok(())
    }
}

/// Implements [`ContactsNotifier`] for `Option<ConnectionGatewayNotifier>`,
/// acting as a no-op when `None`.
impl ContactsNotifier for Option<ConnectionGatewayNotifier> {
    async fn invalidate_contacts_for_users(&self, user_ids: &[MacroUserIdStr<'static>]) -> anyhow::Result<()> {
        if let Some(notifier) = self {
            notifier.invalidate_contacts_for_users(user_ids).await?;
        }
        Ok(())
    }
}
