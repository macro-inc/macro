//! Clear updates over the connection gateway: one small message to every
//! open session of the viewer. Delivery is best effort and never replayed,
//! so the message is a hint: it names the clear and its revision, and each
//! session reads the clear itself.

use std::sync::Arc;

use connection_gateway_client::client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde_json::json;

use crate::domain::{models::ClearAction, ports::ClearUpdates};

#[cfg(test)]
mod test;

/// The gateway message type a session listens for.
pub const NOTIFICATION_INBOX_CLEAR_UPDATED: &str = "notification_inbox_clear_updated";

/// Sends clear updates to the viewer's sessions through the gateway.
#[derive(Clone)]
pub struct GatewayClearUpdates {
    gateway: Arc<ConnectionGatewayClient>,
}

impl GatewayClearUpdates {
    /// Construct over the shared gateway client.
    pub fn new(gateway: Arc<ConnectionGatewayClient>) -> Self {
        Self { gateway }
    }
}

/// What a session is told: which clear changed, where it stands, and the
/// revision that lets it drop an update older than one it already has.
fn payload(action: &ClearAction) -> serde_json::Value {
    let status: &'static str = action.status.into();
    json!({
        "clearId": action.id,
        "status": status,
        "revision": action.revision,
    })
}

impl ClearUpdates for GatewayClearUpdates {
    async fn updated(&self, user: &MacroUserIdStr<'static>, action: &ClearAction) {
        let sent = self
            .gateway
            .send_message(
                EntityType::User.with_entity_str(user.as_ref()),
                NOTIFICATION_INBOX_CLEAR_UPDATED.to_owned(),
                payload(action),
            )
            .await;
        if let Err(error) = sent {
            tracing::warn!(
                error = ?error,
                clear = %action.id,
                "failed to send a notification inbox clear update"
            );
        }
    }
}
