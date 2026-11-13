use std::sync::Arc;

use connection_gateway_client::client::ConnectionGatewayClient;
use model_entity::EntityType;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::drafts::jobs::{DraftUpdate, ROUTINE_DRAFT_UPDATE_MESSAGE_TYPE};
use crate::domain::models::{SCHEDULED_ACTION_UPDATE_MESSAGE_TYPE, ScheduledActionUpdate};
use crate::domain::ports::{RoutineDraftUpdates, ScheduledActionLiveUpdate};

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

impl RoutineDraftUpdates for ConnGatewayLiveUpdates {
    async fn publish_draft(&self, owner: &MacroUserIdStr<'static>, update: DraftUpdate) {
        let payload = match serde_json::to_value(&update) {
            Ok(payload) => payload,
            Err(error) => {
                tracing::error!(error = ?error, draft = %update.draft_id, "failed to serialize a routine draft update");
                return;
            }
        };
        if let Err(error) = self
            .client
            .batch_send_message(
                ROUTINE_DRAFT_UPDATE_MESSAGE_TYPE.to_string(),
                payload,
                vec![EntityType::User.with_entity_str(owner.as_ref())],
            )
            .await
        {
            tracing::warn!(error = ?error, draft = %update.draft_id, "failed to send a routine draft update");
        }
    }
}
