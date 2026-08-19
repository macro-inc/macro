use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, Enum, ID, InputObject, Object};
use graphql_common::{GraphqlEntityType, parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_notifications::NotifEvent;
use notification::domain::{
    models::{
        UserNotificationRow,
        request::{
            NotificationStatus, UpdateNotificationsForEntitiesRequest, UpdateNotificationsRequest,
        },
    },
    service::NotificationReader,
};
use rootcause::Report;
use uuid::Uuid;

use crate::objects::GraphqlNotification;

#[cfg(test)]
mod test;

/// Domain-facing capability required by notification status mutations.
pub trait NotificationMutationService: Send + Sync + 'static {
    /// Update user-owned notifications and return their authoritative active rows.
    fn update_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        status: NotificationStatus,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<NotifEvent>>, Report>> + Send;

    /// Update every user-owned notification associated with any requested entity.
    fn update_notifications_for_entities(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
        status: NotificationStatus,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<NotifEvent>>, Report>> + Send;
}

impl<S> NotificationMutationService for S
where
    S: NotificationReader,
{
    async fn update_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        status: NotificationStatus,
    ) -> Result<Vec<UserNotificationRow<NotifEvent>>, Report> {
        self.update_notifications_and_return::<NotifEvent>(UpdateNotificationsRequest {
            user_id,
            notification_ids: &notification_ids,
            status,
        })
        .await
    }

    async fn update_notifications_for_entities(
        &self,
        user_id: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
        status: NotificationStatus,
    ) -> Result<Vec<UserNotificationRow<NotifEvent>>, Report> {
        // Qualify the trait call to disambiguate it from this method and avoid recursive self-calls.
        NotificationReader::update_notifications_for_entities::<NotifEvent>(
            self,
            UpdateNotificationsForEntitiesRequest {
                user_id,
                entities,
                status,
            },
        )
        .await
    }
}

/// Schema-only notification mutation service.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpNotificationMutationService;

impl NotificationMutationService for NoOpNotificationMutationService {
    async fn update_notifications(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _notification_ids: Vec<Uuid>,
        _status: NotificationStatus,
    ) -> Result<Vec<UserNotificationRow<NotifEvent>>, Report> {
        Err(rootcause::report!(
            "notification mutations are not configured"
        ))
    }

    async fn update_notifications_for_entities(
        &self,
        _user_id: MacroUserIdStr<'static>,
        _entities: Vec<Entity<'static>>,
        _status: NotificationStatus,
    ) -> Result<Vec<UserNotificationRow<NotifEvent>>, Report> {
        Err(rootcause::report!(
            "notification mutations are not configured"
        ))
    }
}

/// Root GraphQL adapter for notification mutations.
pub struct NotificationMutationRoot<S>(PhantomData<S>);

impl<S> NotificationMutationRoot<S> {
    /// Construct a notification mutation root.
    pub fn new() -> Self {
        Self(PhantomData)
    }
}

impl<S> Default for NotificationMutationRoot<S> {
    fn default() -> Self {
        Self::new()
    }
}

/// Explicit notification status operation exposed by GraphQL.
#[derive(Clone, Copy, Debug, Enum, Eq, PartialEq)]
#[graphql(name = "NotificationUpdateOperation")]
pub enum GraphqlNotificationUpdateOperation {
    /// Mark notifications as seen.
    #[graphql(name = "MARK_SEEN")]
    MarkSeen,
    /// Mark notifications as done.
    #[graphql(name = "MARK_DONE")]
    MarkDone,
    /// Mark notifications as not done.
    #[graphql(name = "MARK_UNDONE")]
    MarkUndone,
}

impl From<GraphqlNotificationUpdateOperation> for NotificationStatus {
    fn from(value: GraphqlNotificationUpdateOperation) -> Self {
        match value {
            GraphqlNotificationUpdateOperation::MarkSeen => Self::Seen,
            GraphqlNotificationUpdateOperation::MarkDone => Self::Done(true),
            GraphqlNotificationUpdateOperation::MarkUndone => Self::Done(false),
        }
    }
}

/// Input for updating notification statuses.
#[derive(InputObject)]
pub struct UpdateNotificationsInput {
    /// User notification identifiers to update.
    pub notification_ids: Vec<ID>,
    /// Status operation applied to every requested notification.
    pub operation: GraphqlNotificationUpdateOperation,
}

/// Canonical entity reference used to select notifications for updating.
#[derive(InputObject)]
pub struct NotificationEntityInput {
    /// Canonical entity type.
    pub entity_type: GraphqlEntityType,
    /// Canonical entity identifier.
    pub entity_id: ID,
}

/// Input for updating all notifications associated with any requested entity.
#[derive(InputObject)]
pub struct UpdateNotificationsForEntityInput {
    /// Canonical entities whose notifications should be updated.
    pub entities: Vec<NotificationEntityInput>,
    /// Status operation applied to every matching notification.
    pub operation: GraphqlNotificationUpdateOperation,
}

/// GraphQL notification mutations.
#[Object]
impl<S> NotificationMutationRoot<S>
where
    S: NotificationMutationService,
{
    /// Update authenticated user-owned notifications and return authoritative rows.
    async fn update_notifications(
        &self,
        ctx: &Context<'_>,
        input: UpdateNotificationsInput,
    ) -> async_graphql::Result<Vec<GraphqlNotification>> {
        let user_id = require_authenticated_user(ctx)?;
        let notification_ids = input
            .notification_ids
            .into_iter()
            .map(|id| parse_id(id, "notificationIds"))
            .collect::<async_graphql::Result<Vec<_>>>()?;
        let service = ctx.data::<Arc<S>>()?;
        let notifications = service
            .update_notifications(user_id, notification_ids, input.operation.into())
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;

        Ok(to_graphql_notifications(notifications))
    }

    /// Update all notifications associated with the requested entities for the authenticated user.
    async fn update_notifications_for_entity(
        &self,
        ctx: &Context<'_>,
        input: UpdateNotificationsForEntityInput,
    ) -> async_graphql::Result<Vec<GraphqlNotification>> {
        let user_id = require_authenticated_user(ctx)?;
        let entities = input
            .entities
            .into_iter()
            .map(|entity| {
                entity
                    .entity_type
                    .into_model()
                    .with_entity_string(entity.entity_id.0)
            })
            .collect();
        let service = ctx.data::<Arc<S>>()?;
        let notifications = service
            .update_notifications_for_entities(user_id, entities, input.operation.into())
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;

        Ok(to_graphql_notifications(notifications))
    }
}

/// Convert authoritative domain rows into typed GraphQL notifications.
fn to_graphql_notifications(
    notifications: Vec<UserNotificationRow<NotifEvent>>,
) -> Vec<GraphqlNotification> {
    notifications
        .into_iter()
        .map(GraphqlNotification::from)
        .collect()
}
