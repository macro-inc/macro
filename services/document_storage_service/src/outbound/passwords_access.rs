//! Delivery of committed vault access-request events: an inbox notification
//! to reviewers for a new request, and a private `macro.passwords` hint to the
//! requesting agent for a resolution. Neither grants anything.
use macro_event_broker::MacroEventBroker;
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::PasswordAccessRequestedMetadata;
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};
use password_events::{AccessRequestResolution, AccessRequestResolvedMetadata, PasswordMacroEvent};
use passwords::domain::{
    agent::{
        StoredRequestStatus,
        ports::{AccessEvent, AccessEventSink},
    },
    models::Error,
};
use std::{collections::HashSet, sync::Arc};

/// Adapters are supplied by main, not constructed across crate boundaries.
pub struct PasswordAccessDelivery<I, B> {
    pub ingress: Arc<I>,
    pub broker: B,
}

#[async_trait::async_trait]
impl<I: NotificationIngress + Send + Sync + 'static, B: MacroEventBroker> AccessEventSink
    for PasswordAccessDelivery<I, B>
{
    #[tracing::instrument(name = "passwords.agent.events.deliver_one", skip_all, fields(event_id = %event.id, team_id = %event.team.0, item_id = %event.item.0, request_id = %event.request_id), err)]
    async fn deliver(&self, event: &AccessEvent) -> Result<(), Error> {
        let status = match event.status {
            StoredRequestStatus::Pending => return self.notify_reviewers(event).await,
            StoredRequestStatus::Approved => AccessRequestResolution::Approved,
            StoredRequestStatus::Denied => AccessRequestResolution::Denied,
            StoredRequestStatus::Revoked => AccessRequestResolution::Revoked,
        };
        let published = self
            .broker
            .send_event(&PasswordMacroEvent::access_request_resolved(
                event.id,
                AccessRequestResolvedMetadata {
                    recipient_user_id: event.agent.clone(),
                    team_id: event.team.0,
                    item_id: event.item.0,
                    request_id: event.request_id,
                    status,
                },
            ))
            .map_err(|_| Error::Unavailable)?;
        match published.await {
            Ok(Ok(())) => Ok(()),
            _ => Err(Error::Unavailable),
        }
    }
}

impl<I: NotificationIngress, B> PasswordAccessDelivery<I, B> {
    async fn notify_reviewers(&self, event: &AccessEvent) -> Result<(), Error> {
        let recipients: HashSet<MacroUserIdStr<'static>> =
            event.reviewers.iter().cloned().collect();
        if recipients.is_empty() {
            return Ok(());
        }
        self.ingress
            .send_notification(
                SendNotificationRequestBuilder {
                    // The owning team is the notification's entity; the item and
                    // request ids in the metadata key its row and its click target.
                    notification_entity: model_entity::EntityType::Team
                        .with_entity_string(event.team.0.to_string()),
                    secondary_notification_entity: None,
                    sender_id: Some(event.agent.clone()),
                    recipient_ids: recipients,
                    notification: PasswordAccessRequestedMetadata {
                        request_id: event.request_id,
                        team_id: event.team.0,
                        item_id: event.item.0,
                        item_name: event.item_name.clone(),
                    },
                }
                .into_request_with_id(event.id)
                .with_conn_gateway(),
            )
            .await
            .map_err(|_| Error::Unavailable)
    }
}
