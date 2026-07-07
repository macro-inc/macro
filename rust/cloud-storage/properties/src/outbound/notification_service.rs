//! Notification service implementation for properties.

use std::collections::HashSet;

use futures::future::join_all;
use macro_user_id::cowlike::CowLike;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use sqlx::{Pool, Postgres};

use super::entity_info_queries;
use crate::domain::model::TaskAssignedNotification;
use crate::domain::ports::NotificationService;

/// Notification service implementation using the new notification client.
///
/// Enriches domain-level notifications with display data (task name, sender
/// profile picture) and fans out one notification per recipient.
pub struct NotificationServiceImpl<T> {
    notification_client: T,
    pool: Pool<Postgres>,
}

impl<T> NotificationServiceImpl<T>
where
    T: NotificationIngress,
{
    /// Create a new notification service with the notification client.
    pub fn new(notification_client: T, pool: Pool<Postgres>) -> Self {
        Self {
            notification_client,
            pool,
        }
    }
}

impl<T> NotificationService for NotificationServiceImpl<T>
where
    T: NotificationIngress,
{
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self, notification), fields(task_id = %notification.task_id), err)]
    async fn send_task_assigned<'a>(
        &self,
        notification: TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        // Tasks are stored as documents, so the task name is the document name.
        let task_name =
            entity_info_queries::get_document_name(&self.pool, &notification.task_id.to_string())
                .await?;

        let sender_profile_picture_url = entity_info_queries::get_user_profile_picture(
            &self.pool,
            notification.assigned_by.as_ref(),
        )
        .await
        .ok()
        .flatten();

        let assigned_by = notification.assigned_by.into_owned();
        let notification_entity =
            model_entity::EntityType::Document.with_entity_string(notification.task_id.to_string());

        let notification_futures: Vec<_> = notification
            .recipient_ids
            .iter()
            .map(|recipient_id| {
                let metadata = model_notifications::TaskAssignedMetadata {
                    task_id: notification.task_id.to_string(),
                    task_name: task_name.clone(),
                    sub_type: Some(model_notifications::NotificationDocumentSubType::Task),
                    assigned_by: assigned_by.clone(),
                    sender_profile_picture_url: sender_profile_picture_url.clone(),
                };

                let request = SendNotificationRequestBuilder {
                    notification_entity: notification_entity.clone(),
                    secondary_notification_entity: None,
                    notification: metadata,
                    sender_id: Some(assigned_by.clone()),
                    recipient_ids: HashSet::from([recipient_id.copied()]),
                }
                .into_request()
                .with_apns()
                .with_conn_gateway();

                async move {
                    let send_result = self.notification_client.send_notification(request).await;
                    match send_result {
                        Ok(result) => {
                            tracing::debug!(
                                recipient_id = %recipient_id,
                                notification_id = ?result.map(|r| r.notification_id),
                                "sent task assignment notification"
                            );
                        }
                        Err(e) => {
                            tracing::error!(
                                recipient_id = %recipient_id,
                                error = %e,
                                "failed to send task assignment notification"
                            );
                        }
                    }
                }
            })
            .collect();

        join_all(notification_futures).await;

        Ok(())
    }
}
