use super::*;
use model_entity::EntityType;
use model_notifications::NewEmailMetadata;
use notification::domain::models::{SendNotificationRequest, SendNotificationRequestBuilder};
use notification::domain::service::NotificationIngress;

impl InboxSyncNotifications for InboxSyncEffects {
    fn notify(&self, value: InboxSyncNotification) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let apns = value.apns;
            let request = notification_request(value);
            if apns {
                publish_new_email_notification(self, request.with_apns()).await;
            } else {
                publish_new_email_notification(self, request).await;
            }
        })
    }
}
async fn publish_new_email_notification<U: serde::Serialize + Send + Sync + 'static>(
    ctx: &InboxSyncEffects,
    request: SendNotificationRequest<'_, NewEmailMetadata, U>,
) {
    if let Err(e) = ctx
        .notification_ingress_service
        .send_notification(request)
        .await
    {
        tracing::error!(error=?e, "unable to send notification");
    }
}

fn notification_request(
    value: InboxSyncNotification,
) -> SendNotificationRequest<'static, NewEmailMetadata, ()> {
    let notification = NewEmailMetadata {
        sender: value.sender,
        to_email: value.to_email,
        thread_id: value.thread_id.to_string(),
        subject: value.subject,
        snippet: value.snippet,
    };
    let builder = SendNotificationRequestBuilder {
        notification_entity: EntityType::EmailThread
            .with_entity_string(value.thread_id.to_string()),
        secondary_notification_entity: None,
        notification,
        sender_id: value.sender_id,
        recipient_ids: value.recipients,
    };
    let mut request = builder.into_request();
    if value.realtime {
        request = request.with_conn_gateway();
    }
    request
}

#[cfg(test)]
mod test;
