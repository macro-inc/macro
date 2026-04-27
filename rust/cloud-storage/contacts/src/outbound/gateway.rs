use crate::domain::ports::ContactsNotifier;
use connection_gateway_client::client::ConnectionGatewayClient;

/// Notifier that sends invalidation messages through the connection gateway.
pub struct ConnectionGatewayNotifier {
    client: ConnectionGatewayClient,
}

impl ConnectionGatewayNotifier {
    /// Creates a new notifier with the given gateway client.
    pub fn new(client: ConnectionGatewayClient) -> Self {
        Self { client }
    }
}

impl ContactsNotifier for ConnectionGatewayNotifier {
    async fn invalidate_contacts_for_users(&self, user_ids: &[String]) {
        for user_id in user_ids {
            if let Err(e) = self.client.invalidate_contacts(user_id).await {
                tracing::error!(user_id = %user_id, error = ?e, "Failed to invalidate contacts");
            }
        }
    }
}

/// Implements [`ContactsNotifier`] for `Option<ConnectionGatewayNotifier>`,
/// acting as a no-op when `None`.
impl ContactsNotifier for Option<ConnectionGatewayNotifier> {
    async fn invalidate_contacts_for_users(&self, user_ids: &[String]) {
        if let Some(notifier) = self {
            notifier.invalidate_contacts_for_users(user_ids).await;
        }
    }
}
