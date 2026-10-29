use std::sync::Arc;

use connection_gateway_client::client::ConnectionGatewayClient;
use model_entity::EntityType;

use crate::domain::models::{SCHEDULED_ACTION_UPDATE_MESSAGE_TYPE, ScheduledActionUpdate};
use crate::domain::ports::ScheduledActionLiveUpdate;

/// Pushes scheduled-action status updates to the owner's live websocket
/// connections via the connection gateway. Failures are logged and swallowed
/// so that UI delivery problems never mark an otherwise-successful run as
/// failed.
pub struct ConnGatewayLiveUpdates {
    client: Arc<ConnectionGatewayClient>,
}

impl ConnGatewayLiveUpdates {
    pub fn new(client: Arc<ConnectionGatewayClient>) -> Self {
        Self { client }
    }
}

impl ScheduledActionLiveUpdate for ConnGatewayLiveUpdates {
    async fn publish_update(&self, update: ScheduledActionUpdate) {
        let owner_entity = EntityType::User.with_entity_str(update.owner().as_ref());
        let payload = match serde_json::to_value(&update) {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error=?e, ?update, "failed to serialize scheduled action update");
                return;
            }
        };
        if let Err(e) = self
            .client
            .batch_send_message(
                SCHEDULED_ACTION_UPDATE_MESSAGE_TYPE.to_string(),
                payload,
                vec![owner_entity],
            )
            .await
        {
            tracing::error!(error=?e, ?update, "failed to send scheduled action update");
        }
    }
}
