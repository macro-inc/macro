//! Implementation of GW port using the ConnectionGatewayClient

use connection_gateway_client::ConnectionGatewayClient;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};

use crate::domain::{
    models::{INVALIDATION_MESSAGE_TYPE, InvalidationEvent},
    ports::ConnectionGateway,
};

/// Implementation of the ConnectionGateway trait
#[derive(Clone)]
pub struct ConnectionGatewayImpl {
    /// Inner connection gateway client
    client: ConnectionGatewayClient,
}

impl ConnectionGatewayImpl {
    /// Create a new ConnectionGatewayImpl
    pub fn new(client: ConnectionGatewayClient) -> Self {
        Self { client }
    }
}

impl ConnectionGateway for ConnectionGatewayImpl {
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self), err)]
    async fn bulk_send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        users: &[MacroUserId<Lowercase<'a>>],
        invalidation_event: InvalidationEvent<'a, T>,
    ) -> Result<(), Self::Err> {
        let message = serde_json::to_value(&invalidation_event)?;
        let entities = users
            .iter()
            .map(|u| model_entity::EntityType::User.with_entity_str(u.as_ref()))
            .collect();

        // Transform the users to a list of connection gateway entities
        let result = self
            .client
            .batch_send_message(INVALIDATION_MESSAGE_TYPE.to_string(), message, entities)
            .await?;

        tracing::trace!(result=?result, "batch send message");

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn batch_send_message<'a>(
        &self,
        users: &[MacroUserIdStr<'a>],
        message_type: &str,
        message: serde_json::Value,
    ) -> Result<(), Self::Err> {
        let entities = users
            .iter()
            .map(|u| model_entity::EntityType::User.with_entity_str(u.as_ref()))
            .collect();

        let result = self
            .client
            .batch_send_message(message_type.to_string(), message, entities)
            .await?;

        tracing::trace!(result=?result, "batch send message");

        Ok(())
    }
}
