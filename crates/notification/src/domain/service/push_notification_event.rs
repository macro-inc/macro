//! Service for handling SNS push notification platform events.
//!
//! When an SNS push notification fails delivery or an endpoint is deleted,
//! this service deletes the device registration from the database and
//! optionally removes the SNS endpoint.

#[cfg(test)]
mod test;

use crate::domain::models::email_notification_digest::BulkDigestFailureStateMachine;
use crate::domain::models::push_notification_event::SnsPushNotificationEvent;
use crate::domain::ports::{NotificationRepository, SnsEndpointManager};
use rootcause::Report;
use std::future::Future;

/// Trait for handling push notification platform events.
pub trait PushNotificationEventHandler: Send + Sync + 'static {
    /// Handle a single push notification event.
    ///
    /// Deletes the device from the DB. If the event is a `DeliveryFailure`,
    /// also deletes the SNS endpoint and records the failure in the digest
    /// state machine.
    fn handle_event(
        &self,
        event: &SnsPushNotificationEvent,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Service for handling SNS push notification platform events.
///
/// Generic over three outbound ports: notification repository (DB device deletion),
/// SNS endpoint manager (endpoint deletion), and digest failure state machine.
pub struct PushNotificationEventService<N, S, F> {
    repository: N,
    sns_manager: S,
    digest_failure_sm: F,
}

impl<N, S, F> PushNotificationEventService<N, S, F>
where
    N: NotificationRepository,
    S: SnsEndpointManager,
    F: BulkDigestFailureStateMachine,
{
    /// Create a new push notification event service.
    pub fn new(repository: N, sns_manager: S, digest_failure_sm: F) -> Self {
        Self {
            repository,
            sns_manager,
            digest_failure_sm,
        }
    }
}

impl<N, S, F> PushNotificationEventHandler for PushNotificationEventService<N, S, F>
where
    N: NotificationRepository,
    S: SnsEndpointManager,
    F: BulkDigestFailureStateMachine,
{
    #[tracing::instrument(err, skip(self))]
    async fn handle_event(&self, event: &SnsPushNotificationEvent) -> Result<(), Report> {
        use crate::domain::models::push_notification_event::EventType;

        tracing::info!(
            device_endpoint = event.endpoint_arn,
            event_type = ?event.event_type,
            "deleting endpoint"
        );

        self.repository
            .delete_device_by_endpoint(&event.endpoint_arn)
            .await?;

        match event.event_type {
            EventType::DeliveryFailure => {
                self.sns_manager
                    .delete_endpoint(&event.endpoint_arn)
                    .await?;

                self.digest_failure_sm
                    .mark_message_as_failed(event.message_id.clone())
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "failed to record delivery failure in digest state machine");
                    })
                    .ok();
            }
            EventType::EndpointDeleted => {}
        }

        Ok(())
    }
}
