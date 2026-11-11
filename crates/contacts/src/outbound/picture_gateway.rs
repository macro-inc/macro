use crate::domain::ports::UserPictureNotifier;
use connection_gateway_client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::Report;
use std::sync::Arc;

/// Connection-gateway message type clients listen for.
pub const USER_PICTURE_CHANGED: &str = "user_picture_changed";

/// Sends `user_picture_changed` to contacts through the connection gateway.
#[derive(Clone)]
pub struct ConnectionGatewayPictureNotifier {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayPictureNotifier {
    /// Wrap a connection gateway client.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

impl UserPictureNotifier for ConnectionGatewayPictureNotifier {
    async fn notify_picture_changed(
        &self,
        user_id: &MacroUserIdStr<'_>,
        recipients: &[MacroUserIdStr<'static>],
    ) -> Result<(), Report> {
        if recipients.is_empty() {
            return Ok(());
        }
        self.client
            .batch_send_message(
                USER_PICTURE_CHANGED.to_string(),
                serde_json::json!({ "user_id": user_id.as_ref() }),
                recipients
                    .iter()
                    .map(|r| EntityType::User.with_entity_str(r.as_ref()))
                    .collect(),
            )
            .await
            .map_err(|error| {
                rootcause::report!("connection gateway batch send failed: {error:#}")
            })?;
        Ok(())
    }
}
