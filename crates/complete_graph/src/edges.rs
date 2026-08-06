use std::marker::PhantomData;

use async_graphql::{Context, Object};
use graphql_email::{
    EmailContentKey, GraphqlSoupEmailMessage, SoupEmailContentEdgeReader,
    email_message_selection_requires_full_payload, load_email_messages, load_latest_email_message,
};
use graphql_favorite::{EntityFavoriteEdgeReader, load_entity_favorite};
use graphql_notification::{
    GraphqlSoupNotification, SoupNotificationEdgeReader, load_entity_notifications,
};
use graphql_permission::{
    EntityPermissionEdgeReader, GraphqlEntityPermission, load_entity_permission,
};
use graphql_properties::{EntityPropertyReader, GraphqlProperty, load_entity_properties};
use graphql_soup::SoupEntityEdges;
use uuid::Uuid;

/// The types of the edge readers for soup
type EdgeReaders<NR, PR, ER, FR, AR> = PhantomData<fn() -> (NR, PR, ER, FR, AR)>;

/// Notification, property, email-content, favorite, and permission fields
/// attached to Soup entities.
///
/// This concrete edge shape lives in the composition crate so `graphql_soup`
/// does not know which cross-domain fields are attached to its objects.
pub struct SoupEdges<NR, PR, ER, FR, AR> {
    /// Entity whose cross-domain fields are being resolved.
    entity: model_entity::Entity<'static>,
    /// Entity whose access determines the viewer permission for this object.
    permission_entity: model_entity::Entity<'static>,
    /// Associates the edge with its configured reader types.
    _readers: EdgeReaders<NR, PR, ER, FR, AR>,
}

impl<NR, PR, ER, FR, AR> Clone for SoupEdges<NR, PR, ER, FR, AR> {
    fn clone(&self) -> Self {
        Self {
            entity: self.entity.clone(),
            permission_entity: self.permission_entity.clone(),
            _readers: PhantomData,
        }
    }
}

impl<NR, PR, ER, FR, AR> SoupEntityEdges for SoupEdges<NR, PR, ER, FR, AR>
where
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
{
    type Property = GraphqlProperty;
    type Notification = GraphqlSoupNotification;
    type EmailThreadEdges = SoupEmailThreadEdges<ER>;

    fn from_entity(entity: model_entity::Entity<'static>) -> Self {
        Self {
            permission_entity: entity.clone(),
            entity,
            _readers: PhantomData,
        }
    }

    fn from_channel_message(message_id: Uuid, channel_id: Uuid) -> Self {
        Self {
            entity: model_entity::EntityType::ChannelMessage
                .with_entity_string(message_id.to_string()),
            permission_entity: model_entity::EntityType::Channel
                .with_entity_string(channel_id.to_string()),
            _readers: PhantomData,
        }
    }

    fn email_thread_edges(thread_id: Uuid) -> Self::EmailThreadEdges {
        SoupEmailThreadEdges {
            thread_id,
            _reader: PhantomData,
        }
    }

    async fn resolve_properties(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Property>> {
        load_entity_properties::<PR>(ctx, self.entity.clone()).await
    }

    async fn resolve_notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<Self::Notification>> {
        load_entity_notifications::<NR>(ctx, self.entity.clone()).await
    }

    async fn resolve_is_favorited(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        load_entity_favorite::<FR>(ctx, self.entity.clone()).await
    }

    async fn resolve_viewer_permission(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlEntityPermission>> {
        load_entity_permission::<AR>(ctx, self.permission_entity.clone()).await
    }
}

/// Cross-domain fields attached to a property-bearing Soup entity.
#[Object(name = "SoupEdges")]
impl<NR, PR, ER, FR, AR> SoupEdges<NR, PR, ER, FR, AR>
where
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
{
    /// Properties assigned to this entity that the authenticated user may view.
    async fn properties(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphqlProperty>> {
        self.resolve_properties(ctx).await
    }

    /// Notifications associated with this entity for the authenticated user.
    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        self.resolve_notifications(ctx).await
    }

    /// Whether the authenticated viewer has favorited this entity.
    async fn is_favorited(&self, ctx: &Context<'_>) -> async_graphql::Result<bool> {
        self.resolve_is_favorited(ctx).await
    }

    /// The authenticated viewer's effective permission for this entity.
    async fn viewer_permission(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlEntityPermission>> {
        self.resolve_viewer_permission(ctx).await
    }
}

/// default limit of messages if none is provided
/// REST-compatible default number of email messages returned per page.
const DEFAULT_EMAIL_MESSAGE_LIMIT: i32 = 5;
/// max possible limit of messages
/// Maximum number of email messages one field may request.
const MAX_EMAIL_MESSAGE_LIMIT: i32 = 100;

/// parses the incoming optional limits into the actual range
/// Validate email-message pagination and apply REST-compatible defaults.
fn parse_email_message_pagination(
    offset: Option<i32>,
    limit: Option<i32>,
) -> async_graphql::Result<(u32, u32)> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(DEFAULT_EMAIL_MESSAGE_LIMIT);

    let offset = u32::try_from(offset)
        .map_err(|_| async_graphql::Error::new("offset must be non-negative"))?;
    if limit <= 0 {
        return Err(async_graphql::Error::new("limit must be positive"));
    }
    if limit > MAX_EMAIL_MESSAGE_LIMIT {
        return Err(async_graphql::Error::new(format!(
            "limit must not exceed {MAX_EMAIL_MESSAGE_LIMIT}"
        )));
    }

    Ok((
        offset,
        u32::try_from(limit).expect("positive GraphQL Int fits in u32"),
    ))
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
    /// A page of messages in this thread, newest first.
    async fn messages(
        &self,
        ctx: &Context<'_>,
        offset: Option<i32>,
        limit: Option<i32>,
    ) -> async_graphql::Result<Vec<GraphqlSoupEmailMessage>> {
        let (offset, limit) = parse_email_message_pagination(offset, limit)?;
        let key = if email_message_selection_requires_full_payload(ctx) {
            EmailContentKey::page_full(self.thread_id, offset, limit)
        } else {
            EmailContentKey::page(self.thread_id, offset, limit)
        };
        load_email_messages::<ER>(ctx, key).await
    }

    /// The newest non-draft content message in this thread.
    async fn latest_content_message(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupEmailMessage>> {
        load_latest_email_message::<ER>(ctx, self.thread_id).await
    }
}

#[cfg(test)]
mod test;
