//! GraphQL arguments for an existing notification edge.

use async_graphql::InputObject;
use notification::domain::models::entity_query::EntityNotificationQuery;
use notification_state::graphql::GraphqlNotificationState;

/// Filters applied before the per-entity notification limit.
#[derive(Default, Clone, InputObject)]
pub struct GraphqlNotificationFilter {
    /// Exact states to include; omitted means active (unseen and seen).
    /// An empty list matches no notifications.
    pub states: Option<Vec<GraphqlNotificationState>>,
    /// Event names to include; omitted or empty means every event type.
    pub event_types: Option<Vec<String>>,
}

impl GraphqlNotificationFilter {
    /// Decode transport arguments and delegate bounds to the domain query.
    pub(crate) fn into_query(
        self,
        limit: Option<i32>,
    ) -> async_graphql::Result<EntityNotificationQuery> {
        let mut query = EntityNotificationQuery::default();
        if let Some(states) = self.states {
            query.states = states.into_iter().map(Into::into).collect();
        }
        query.event_types = self.event_types.unwrap_or_default();
        query.limit = limit
            .map(u32::try_from)
            .transpose()
            .map_err(|_| async_graphql::Error::new("notification edge limit must be positive"))?;
        query
            .validate()
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;
        // Equivalent selections share a DataLoader batch, regardless of argument order.
        query.states.sort_by_key(|state| *state as u8);
        query.states.dedup();
        query.event_types.sort();
        query.event_types.dedup();
        Ok(query)
    }
}
