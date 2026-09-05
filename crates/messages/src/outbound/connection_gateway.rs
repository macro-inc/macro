use crate::domain::{delivery::MessageRealtime, models::MessageParent, ports::MessageEvent};
use connection_gateway_client::client::ConnectionGatewayClient;
use model_entity::{Entity, EntityType};
use std::collections::HashSet;

/// Shared event transport targeting individually authorized users.
#[derive(Clone)]
pub struct ConnectionGatewayMessages(pub std::sync::Arc<ConnectionGatewayClient>);

fn entity(parent: &MessageParent) -> Entity<'static> {
    let kind = match parent {
        MessageParent::Channel(_) => EntityType::Channel,
        MessageParent::Document(_) => EntityType::Document,
        MessageParent::EmailThread(_) => EntityType::EmailThread,
    };
    kind.with_entity_string(parent.entity_id())
}

impl MessageRealtime for ConnectionGatewayMessages {
    async fn subscribers(
        &self,
        parent: &MessageParent,
    ) -> Result<HashSet<String>, rootcause::Report> {
        self.0
            .track_entity_users(entity(parent))
            .await
            .map(|users| users.into_iter().collect())
            .map_err(|e| rootcause::report!("failed to read message subscribers: {e}"))
    }

    async fn send(
        &self,
        event: &MessageEvent,
        users: HashSet<String>,
    ) -> Result<(), rootcause::Report> {
        if users.is_empty() {
            return Ok(());
        }
        let targets = users
            .into_iter()
            .map(|u| EntityType::User.with_entity_string(u))
            .collect();
        self.0
            .batch_send_message(
                "message_update".into(),
                serde_json::to_value(event)?,
                targets,
            )
            .await
            .map_err(|e| rootcause::report!("failed to send message event: {e}"))?;
        Ok(())
    }
}
