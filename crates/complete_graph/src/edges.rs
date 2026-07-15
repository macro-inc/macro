use std::marker::PhantomData;

use async_graphql::{Context, Object};
use graphql_email::{
    EmailContentKey, GraphqlSoupEmailMessage, SoupEmailContentEdgeReader, load_latest_email_message,
};
use graphql_notification::{
    GraphqlSoupNotification, SoupNotificationEdgeReader, load_entity_notifications,
};
use graphql_properties::{EntityPropertyReader, GraphqlProperty, load_entity_properties};
use graphql_soup::SoupEntityEdges;
use uuid::Uuid;

/// The types of the edge readers for soup
type EdgeReaders<NR, PR, ER> = PhantomData<fn() -> (NR, PR, ER)>;

/// Notification, property, and email-content fields attached to Soup entities.
///
/// This concrete edge shape lives in the composition crate so `graphql_soup`
/// does not know which cross-domain fields are attached to its objects.
pub struct SoupEdges<NR, PR, ER> {
    /// Entity whose cross-domain fields are being resolved.
    entity: model_entity::Entity<'static>,
    /// Associates the edge with its configured reader types.
    _readers: EdgeReaders<NR, PR, ER>,
}

impl<NR, PR, ER> Clone for SoupEdges<NR, PR, ER> {
    fn clone(&self) -> Self {
        Self {
            entity: self.entity.clone(),
            _readers: PhantomData,
        }
    }
}

impl<NR, PR, ER> SoupEntityEdges for SoupEdges<NR, PR, ER>
where
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
{
    type EmailThreadEdges = SoupEmailThreadEdges<ER>;

    fn from_entity(entity: model_entity::Entity<'static>) -> Self {
        Self {
            entity,
            _readers: PhantomData,
        }
    }

    fn email_thread_edges(thread_id: Uuid) -> Self::EmailThreadEdges {
        SoupEmailThreadEdges {
            thread_id,
            _reader: PhantomData,
        }
    }
}

/// Cross-domain fields attached to a property-bearing Soup entity.
#[Object(name = "SoupEdges")]
impl<NR, PR, ER> SoupEdges<NR, PR, ER>
where
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
{
    /// Properties assigned to this entity that the authenticated user may view.
    async fn properties(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphqlProperty>> {
        load_entity_properties::<PR>(ctx, self.entity.clone()).await
    }

    /// Notifications associated with this entity for the authenticated user.
    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications::<NR>(ctx, self.entity.clone()).await
    }
}

/// Email-content fields attached only to Soup email-thread entities.
pub struct SoupEmailThreadEdges<ER> {
    /// The uuid of the email thread
    thread_id: Uuid,
    /// marker for the reader type
    _reader: PhantomData<fn() -> ER>,
}

impl<ER> Clone for SoupEmailThreadEdges<ER> {
    fn clone(&self) -> Self {
        Self {
            thread_id: self.thread_id,
            _reader: PhantomData,
        }
    }
}

/// Email-content fields attached to a Soup email thread.
#[Object]
impl<ER> SoupEmailThreadEdges<ER>
where
    ER: SoupEmailContentEdgeReader,
{
    /// The newest non-draft content message in this thread.
    async fn latest_content_message(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupEmailMessage>> {
        load_latest_email_message::<ER>(
            ctx,
            EmailContentKey {
                thread_id: self.thread_id,
            },
        )
        .await
    }
}
