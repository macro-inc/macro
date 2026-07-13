use std::marker::PhantomData;

use async_graphql::{Context, Object};
use graphql_notification::{
    GraphqlSoupNotification, SoupNotificationEdgeReader, load_entity_notifications,
};
use graphql_properties::{GraphqlSoupProperty, SoupPropertyEdgeReader, load_entity_properties};
use graphql_soup::SoupEntityEdges;

/// Notification and property fields attached to property-bearing Soup entities.
///
/// This concrete edge shape lives in the composition crate so `graphql_soup`
/// does not know which cross-domain fields are attached to its objects.
pub struct SoupEdges<NR, PR> {
    entity: model_entity::Entity<'static>,
    _readers: PhantomData<fn() -> (NR, PR)>,
}

impl<NR, PR> Clone for SoupEdges<NR, PR> {
    fn clone(&self) -> Self {
        Self {
            entity: self.entity.clone(),
            _readers: PhantomData,
        }
    }
}

impl<NR, PR> SoupEntityEdges for SoupEdges<NR, PR>
where
    NR: SoupNotificationEdgeReader,
    PR: SoupPropertyEdgeReader,
{
    fn from_entity(entity: model_entity::Entity<'static>) -> Self {
        Self {
            entity,
            _readers: PhantomData,
        }
    }
}

#[Object(name = "SoupEdges")]
impl<NR, PR> SoupEdges<NR, PR>
where
    NR: SoupNotificationEdgeReader,
    PR: SoupPropertyEdgeReader,
{
    async fn properties(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupProperty>> {
        load_entity_properties::<PR>(ctx, self.entity.clone()).await
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications::<NR>(ctx, self.entity.clone()).await
    }
}
