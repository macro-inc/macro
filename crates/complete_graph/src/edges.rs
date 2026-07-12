use std::marker::PhantomData;

use async_graphql::{Context, Object};
use graphql_notification::{
    GraphqlSoupNotification, SoupNotificationEdgeReader, load_entity_notifications,
};
use graphql_soup::SoupEntityEdges;

/// Notification fields attached to each top-level Soup entity.
///
/// This concrete edge shape lives in the composition crate so `graphql_soup`
/// does not know which cross-domain fields are attached to its objects.
pub struct SoupNotificationEdges<R> {
    entity: model_entity::Entity<'static>,
    _reader: PhantomData<fn() -> R>,
}

impl<R> Clone for SoupNotificationEdges<R> {
    fn clone(&self) -> Self {
        Self {
            entity: self.entity.clone(),
            _reader: PhantomData,
        }
    }
}

impl<R> SoupEntityEdges for SoupNotificationEdges<R>
where
    R: SoupNotificationEdgeReader,
{
    fn from_entity(entity: model_entity::Entity<'static>) -> Self {
        Self {
            entity,
            _reader: PhantomData,
        }
    }
}

#[Object(name = "SoupNotificationEdges")]
impl<R> SoupNotificationEdges<R>
where
    R: SoupNotificationEdgeReader,
{
    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        // CRM companies have no corresponding notification item type. Keep
        // their existing GraphQL behavior rather than asking the loader to
        // translate an unsupported entity type.
        if self.entity.entity_type == model_entity::EntityType::CrmCompany {
            return Ok(Vec::new());
        }

        load_entity_notifications::<R>(ctx, self.entity.clone()).await
    }
}
