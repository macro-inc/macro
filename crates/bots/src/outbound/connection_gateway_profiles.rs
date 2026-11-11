//! Connection-gateway adapter that pushes changed bot profiles to web clients.

use std::sync::Arc;

use connection_gateway_client::ConnectionGatewayClient;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use rootcause::{Report, compat::IntoRootcause};

use crate::domain::{models::BotOwnerProfile, ports::BotProfilePublisher};

/// Gateway message type the web client applies to its bot profile cache.
const BOT_PROFILE_CHANGED: &str = "bot_profile_changed";

/// Sends `bot_profile_changed` messages through the connection gateway.
#[derive(Clone)]
pub struct ConnectionGatewayBotProfilePublisher {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnectionGatewayBotProfilePublisher {
    /// Build the publisher over a connection-gateway client.
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

impl BotProfilePublisher for ConnectionGatewayBotProfilePublisher {
    async fn publish_profile(
        &self,
        profile: BotOwnerProfile,
        recipients: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        let message = serde_json::to_value(profile).map_err(Report::new)?;
        self.client
            .batch_send_message(
                BOT_PROFILE_CHANGED.to_string(),
                message,
                recipients
                    .iter()
                    .map(|recipient| EntityType::User.with_entity_str(recipient.as_ref()))
                    .collect(),
            )
            .await
            .map_err(|error| error.into_rootcause())?;
        Ok(())
    }
}
