//! Connection-gateway implementation of the import service's notify hook.
//!
//! Every ledger/run mutation calls the service's [`ImportNotify`]; this
//! adapter pushes an `import_updated` message to the user's connected
//! clients so setup sections and chat surfaces update immediately instead
//! of on the next poll. Push failures only warn — polling is the backstop.

use crate::domain::service::ImportNotify;
use connection_gateway_client::ConnectionGatewayClient;
use std::sync::Arc;

/// The gateway message type pushed on import changes. The web client
/// invalidates its import state query when it sees this.
pub const IMPORT_UPDATED_MESSAGE_TYPE: &str = "import_updated";

/// Build an [`ImportNotify`] that pushes [`IMPORT_UPDATED_MESSAGE_TYPE`]
/// to the user's connections through `gateway`.
pub fn gateway_import_notify(gateway: Arc<ConnectionGatewayClient>) -> ImportNotify {
    Arc::new(move |user| {
        let gateway = gateway.clone();
        Box::pin(async move {
            let entity = model_entity::EntityType::User.with_entity_str(user.as_ref());
            let payload = serde_json::json!({ "type": IMPORT_UPDATED_MESSAGE_TYPE });
            if let Err(e) = gateway
                .send_message(entity, IMPORT_UPDATED_MESSAGE_TYPE.to_string(), payload)
                .await
            {
                tracing::warn!(error = ?e, "failed to push import update");
            }
        })
    })
}
