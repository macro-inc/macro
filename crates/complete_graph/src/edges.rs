use std::marker::PhantomData;

use async_graphql::{Context, Object};
use graphql_notification::{
    GraphqlSoupNotification, SoupNotificationEdgeReader, load_entity_notifications,
};
use graphql_properties::{GraphqlSoupProperty, SoupPropertyEdgeReader, load_entity_properties};
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
        load_notifications::<R>(ctx, &self.entity).await
    }
}

/// Notification and property fields attached to property-bearing Soup entities.
pub struct SoupPropertyEdges<NR, PR> {
    entity: model_entity::Entity<'static>,
    _readers: PhantomData<fn() -> (NR, PR)>,
}

impl<NR, PR> Clone for SoupPropertyEdges<NR, PR> {
    fn clone(&self) -> Self {
        Self {
            entity: self.entity.clone(),
            _readers: PhantomData,
        }
    }
}

impl<NR, PR> SoupEntityEdges for SoupPropertyEdges<NR, PR>
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

#[Object(name = "SoupPropertyEdges")]
impl<NR, PR> SoupPropertyEdges<NR, PR>
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
        load_notifications::<NR>(ctx, &self.entity).await
    }
}

async fn load_notifications<R>(
    ctx: &Context<'_>,
    entity: &model_entity::Entity<'static>,
) -> async_graphql::Result<Vec<GraphqlSoupNotification>>
where
    R: SoupNotificationEdgeReader,
{
    // CRM companies have no corresponding notification item type. Keep their
    // existing behavior rather than asking the loader to translate them.
    if entity.entity_type == model_entity::EntityType::CrmCompany {
        return Ok(Vec::new());
    }

    load_entity_notifications::<R>(ctx, entity.clone()).await
}
