use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, Enum, ID, InputObject, Object};
use graphql_common::{parse_id, require_authenticated_user};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::{
    models::{UserNotificationRow, request::NotificationStatus},
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
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<serde_json::Value>>, Report>> + Send;
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
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
        self.update_notifications_and_return(
            notification::domain::models::request::UpdateNotificationsRequest {
                user_id,
                notification_ids: &notification_ids,
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
    ) -> Result<Vec<UserNotificationRow<serde_json::Value>>, Report> {
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

        notifications
            .into_iter()
            .map(GraphqlNotification::try_from)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| {
                tracing::error!(
                    error = ?error,
                    "failed to deserialize notification metadata"
                );
                async_graphql::Error::new("notification metadata is unavailable")
            })
    }
}
