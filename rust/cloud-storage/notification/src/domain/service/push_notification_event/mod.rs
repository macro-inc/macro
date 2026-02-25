//! Service for handling SNS push notification platform events.
//!
//! When an SNS push notification fails delivery or an endpoint is deleted,
//! this service deletes the device registration from the database and
//! optionally removes the SNS endpoint.

#[cfg(test)]
mod test;

use crate::domain::models::push_notification_event::SnsPushNotificationEvent;
use crate::domain::ports::{DeviceRegistrationDeleter, SnsEndpointDeleter};
use rootcause::Report;
use std::future::Future;

/// Trait for handling push notification platform events.
pub trait PushNotificationEventHandler: Send + Sync + 'static {
    /// Handle a single push notification event.
    ///
    /// Deletes the device from the DB. If the event is a `DeliveryFailure`,
    /// also deletes the SNS endpoint.
    fn handle_event(
        &self,
        event: &SnsPushNotificationEvent,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Service for handling SNS push notification platform events.
///
/// Generic over the two outbound ports: device registration deletion (DB) and
/// SNS endpoint deletion.
pub struct PushNotificationEventService<D, S> {
    device_deleter: D,
    sns_deleter: S,
}

impl<D, S> PushNotificationEventService<D, S>
where
    D: DeviceRegistrationDeleter,
    S: SnsEndpointDeleter,
{
    /// Create a new push notification event service.
    pub fn new(device_deleter: D, sns_deleter: S) -> Self {
        Self {
            device_deleter,
            sns_deleter,
        }
    }
}

impl<D, S> PushNotificationEventHandler for PushNotificationEventService<D, S>
where
    D: DeviceRegistrationDeleter,
    S: SnsEndpointDeleter,
{
    #[tracing::instrument(err, skip(self))]
    async fn handle_event(&self, event: &SnsPushNotificationEvent) -> Result<(), Report> {
        use crate::domain::models::push_notification_event::EventType;

        tracing::info!(
            device_endpoint = event.endpoint_arn,
            event_type = ?event.event_type,
            "deleting endpoint"
        );

        self.device_deleter
            .delete_device_by_endpoint(&event.endpoint_arn)
            .await?;

        match event.event_type {
            EventType::DeliveryFailure => {
                self.sns_deleter
                    .delete_endpoint(&event.endpoint_arn)
                    .await?;
            }
            EventType::EndpointDeleted => {}
        }

        Ok(())
    }
}
