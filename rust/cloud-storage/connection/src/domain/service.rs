//! Connection service implementation.

use std::sync::Arc;

use entity_access::domain::ports::EntityAccessService;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};

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
        let users = users
            .into_iter()
            .filter_map(|p| {
                if p.as_ref() != invalidation_event.invalidated_by.as_ref() {
                    Some(p.0)
                } else {
                    None
                }
            })
            .collect::<Vec<MacroUserId<Lowercase<'a>>>>();

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
}
