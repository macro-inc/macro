//! Access-request delivery through the existing notification and connection ports.
use access_requests::domain::{
    models::{RequestEvent, RequestStatus},
    ports::RequestEventSink,
};
use connection::domain::ports::ConnectionGateway;
use model_notifications::{
    EntityAccessGrantedMetadata, EntityAccessRequestedMetadata, RequestedAccessLevel,
};
use models_permissions::share_permission::access_level::AccessLevel;
use notification::domain::{
    models::{
        SendNotificationRequestBuilder,
        request::{NotificationStatus, UpdateNotificationsRequest},
    },
    service::{NotificationIngress, NotificationReader},
};
use rootcause::prelude::IntoRootcause;
use std::{collections::HashSet, sync::Arc};

/// Adapters are supplied by main, not constructed across crate boundaries.
pub struct AccessRequestDelivery<I, N, C, W> {
    pub ingress: Arc<I>,
    pub withdrawal: Arc<W>,
    pub reader: Arc<N>,
    pub connection: Arc<C>,
}
impl<
    I: NotificationIngress,
    N: NotificationReader,
    C: ConnectionGateway,
    W: notification::domain::ports::NotificationWithdrawal,
> RequestEventSink for AccessRequestDelivery<I, N, C, W>
{
    #[tracing::instrument(name = "access_requests.notify", skip_all, fields(event_id = %event.id, entity_id = %event.entity.entity_id), err)]
    async fn deliver(&self, event: &RequestEvent) -> Result<(), rootcause::Report> {
        if let Some(request) = &event.request {
            let level = request.granted_level.unwrap_or(request.requested_level);
            let access_level = match level {
                AccessLevel::View => RequestedAccessLevel::View,
                AccessLevel::Comment => RequestedAccessLevel::Comment,
                AccessLevel::Edit => RequestedAccessLevel::Edit,
                _ => {
                    return Err(rootcause::report!(
                        "invalid access request notification level"
                    ));
                }
            };
            let notification_entity = model_entity::EntityType::from(event.entity.entity_type)
                .with_entity_string(event.entity.entity_id.to_string());
            match request.status {
                RequestStatus::Pending => {
                    self.ingress
                        .send_notification(
                            SendNotificationRequestBuilder {
                                notification_entity,
                                secondary_notification_entity: None,
                                sender_id: Some(event.actor.clone()),
                                recipient_ids: event.reviewers.iter().cloned().collect(),
                                notification: EntityAccessRequestedMetadata {
                                    request_id: request.id,
                                    revision: request.revision,
                                    entity_name: event.entity_name.clone(),
                                    file_type: event.file_type.clone(),
                                    access_level,
                                },
                            }
                            .into_request_with_id(event.id)
                            .with_apns()
                            .with_conn_gateway(),
                        )
                        .await?;
                }
                RequestStatus::Granted => {
                    self.ingress
                        .send_notification(
                            SendNotificationRequestBuilder {
                                notification_entity,
                                secondary_notification_entity: None,
                                sender_id: Some(event.actor.clone()),
                                recipient_ids: HashSet::from([request.requester_id.clone()]),
                                notification: EntityAccessGrantedMetadata {
                                    request_id: request.id,
                                    revision: request.revision,
                                    entity_name: event.entity_name.clone(),
                                    file_type: event.file_type.clone(),
                                    access_level,
                                },
                            }
                            .into_request_with_id(event.id)
                            .with_apns()
                            .with_conn_gateway(),
                        )
                        .await?;
                }
                RequestStatus::Denied | RequestStatus::Cancelled => {}
            }
        }
        for (id, recipients) in &event.superseded {
            self.withdrawal.withdraw(*id).await?;
            for user in recipients {
                self.reader
                    .update_notifications(UpdateNotificationsRequest {
                        user_id: user.clone(),
                        notification_ids: &[*id],
                        status: NotificationStatus::Done(true),
                    })
                    .await?;
            }
        }
        self.connection.batch_send_message(&event.affected_users, "access_requests_changed", serde_json::json!({"entityType": event.entity.entity_type, "entityId": event.entity.entity_id})).await.map_err(|e| e.into().into_rootcause())?;
        Ok(())
    }
}
