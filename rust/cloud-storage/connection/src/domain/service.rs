//! Connection service implementation.

use std::sync::Arc;

use entity_access::domain::ports::EntityAccessService;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

use entity_access::domain::models::EntityType;

use crate::domain::{
    models::{ConnectionError, InvalidationEvent},
    ports::{ConnectionGateway, ConnectionService},
};

/// The connection service implementation
pub struct ConnectionServiceImpl<E: EntityAccessService, Cgw: ConnectionGateway> {
    /// The entity access service
    entity_access_service: Arc<E>,
    /// The connection gateway
    connection_gateway: Arc<Cgw>,
}

impl<E: EntityAccessService, Cgw: ConnectionGateway> ConnectionServiceImpl<E, Cgw> {
    /// Create new instance
    pub fn new(entity_access_service: Arc<E>, connection_gateway: Arc<Cgw>) -> Self {
        Self {
            entity_access_service,
            connection_gateway,
        }
    }
}

impl<E: EntityAccessService, Cgw: ConnectionGateway> ConnectionService
    for ConnectionServiceImpl<E, Cgw>
{
    #[tracing::instrument(skip(self), err)]
    async fn send_invalidation_event<'a, T: std::fmt::Debug + serde::Serialize + Send>(
        &self,
        invalidation_event: InvalidationEvent<'a, T>,
    ) -> Result<(), ConnectionError> {
        let users = self
            .entity_access_service
            .get_users_by_entity(
                &invalidation_event.entity_id,
                invalidation_event.entity_type,
            )
            .await
            .map_err(|e| ConnectionError::Internal(e.into()))?;

        // Filter out user who made the invalidation
        let users = match &invalidation_event.invalidated_by {
            entity_access::domain::models::EntityAccessAuth::Authenticated(macro_user_id_str) => {
                users
                    .into_iter()
                    .filter_map(|p| {
                        if p.as_ref() != macro_user_id_str.as_ref() {
                            Some(p.0)
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<MacroUserId<Lowercase<'a>>>>()
            }
            entity_access::domain::models::EntityAccessAuth::Unauthenticated
            | entity_access::domain::models::EntityAccessAuth::Internal => {
                users.into_iter().map(|s| s.0.to_owned()).collect()
            }
        };

        if users.is_empty() {
            tracing::trace!("no users to send invalidation to");
            return Ok(());
        }

        // send event to all users
        self.connection_gateway
            .bulk_send_invalidation_event(&users, invalidation_event)
            .await
            .map_err(|e| ConnectionError::Internal(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn send_channel_message(
        &self,
        channel_id: &str,
        message_type: &str,
        message: serde_json::Value,
        triggered_by: entity_access::domain::models::EntityAccessAuth,
    ) -> Result<(), ConnectionError> {
        let users = self
            .entity_access_service
            .get_users_by_entity(channel_id, EntityType::Channel)
            .await
            .map_err(|e| ConnectionError::Internal(e.into()))?;

        let users = match &triggered_by {
            entity_access::domain::models::EntityAccessAuth::Authenticated(macro_user_id_str) => {
                users
                    .into_iter()
                    .filter_map(|p| {
                        if p.as_ref() != macro_user_id_str.as_ref() {
                            Some(p.0)
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<MacroUserId<Lowercase<'_>>>>()
            }
            entity_access::domain::models::EntityAccessAuth::Unauthenticated
            | entity_access::domain::models::EntityAccessAuth::Internal => {
                users.into_iter().map(|s| s.0.to_owned()).collect()
            }
        };

        if users.is_empty() {
            tracing::trace!("no users to send channel message to");
            return Ok(());
        }

        self.connection_gateway
            .batch_send_message(&users, message_type, message)
            .await
            .map_err(|e| ConnectionError::Internal(e.into()))?;

        Ok(())
    }
}
