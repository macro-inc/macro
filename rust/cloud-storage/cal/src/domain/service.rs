//! Cal.com webhook service implementation.

use std::collections::HashMap;

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::domain::models::{
    BookingCreated, CalError, CalTriggerEvent, CalWebhookEnvelope, CalWebhookEvent,
};
use crate::domain::ports::{AnalyticsSink, CalWebhookService};

type HmacSha256 = Hmac<Sha256>;

/// Configuration for the cal.com webhook service.
#[derive(Debug, Clone)]
pub struct CalConfig {
    /// Shared secret configured on the cal.com webhook. Used to verify the
    /// HMAC-SHA256 signature in `X-Cal-Signature-256`.
    pub webhook_secret: String,
    /// Maps cal.com `eventTypeId` to the Meta `content_name` we fire for it.
    ///
    /// Bookings whose event type id is absent from this map are logged and
    /// skipped: we'd rather miss a Lead than fire an unlabeled one when
    /// someone adds a new event type in cal.com.
    pub event_type_content_names: HashMap<u64, String>,
}

/// Concrete cal.com webhook service.
///
/// Generic over an [`AnalyticsSink`] so the outbound adapter can be swapped
/// (production: `analytics_client`; tests: a mock).
pub struct CalWebhookServiceImpl<A> {
    config: CalConfig,
    analytics: A,
}

impl<A> CalWebhookServiceImpl<A> {
    /// Create a new service.
    pub fn new(config: CalConfig, analytics: A) -> Self {
        Self { config, analytics }
    }
}

impl<A: AnalyticsSink> CalWebhookService for CalWebhookServiceImpl<A> {
    #[tracing::instrument(err, skip(self, body))]
    async fn validate_webhook_event(
        &self,
        signature: &str,
        body: &[u8],
    ) -> Result<CalWebhookEvent, CalError> {
        let sig_bytes = hex::decode(signature).map_err(|_| CalError::InvalidWebhookSignature)?;

        let mut mac = HmacSha256::new_from_slice(self.config.webhook_secret.as_bytes())
            .map_err(|e| CalError::Internal(rootcause::report!("invalid webhook secret: {e}")))?;
        mac.update(body);
        mac.verify_slice(&sig_bytes)
            .map_err(|_| CalError::InvalidWebhookSignature)?;

        let envelope: CalWebhookEnvelope =
            serde_json::from_slice(body).map_err(|_| CalError::InvalidPayload)?;

        // Log every authenticated webhook, even ones we don't yet handle, so
        // absence of handling is observable (unsupported events short-circuit
        // below with 204, bypassing the handler).
        tracing::info!(trigger_event = %envelope.trigger_event, "received cal webhook");

        match CalTriggerEvent::parse(&envelope.trigger_event) {
            CalTriggerEvent::BookingCreated => {
                let booking: BookingCreated =
                    serde_json::from_value(envelope.payload).map_err(|e| {
                        tracing::warn!(error=?e, "failed to parse BOOKING_CREATED payload");
                        CalError::InvalidPayload
                    })?;
                Ok(CalWebhookEvent::BookingCreated(booking))
            }
            CalTriggerEvent::Unsupported(raw) => Err(CalError::UnsupportedEvent(raw)),
        }
    }

    #[tracing::instrument(err, skip(self, event))]
    async fn process_webhook_event(&self, event: &CalWebhookEvent) -> Result<(), CalError> {
        match event {
            CalWebhookEvent::BookingCreated(booking) => {
                let Some(event_type_id) = booking.event_type_id else {
                    tracing::warn!(uid = %booking.uid, "cal booking missing eventTypeId, skipping analytics");
                    return Ok(());
                };

                let Some(content_name) = self.config.event_type_content_names.get(&event_type_id)
                else {
                    tracing::warn!(
                        uid = %booking.uid,
                        event_type_id,
                        "unmapped cal eventTypeId, skipping analytics",
                    );
                    return Ok(());
                };

                tracing::info!(
                    uid = %booking.uid,
                    event_type_id,
                    content_name = %content_name,
                    "processing cal BOOKING_CREATED",
                );
                self.analytics
                    .on_booking_created(booking, content_name)
                    .await?;
                Ok(())
            }
        }
    }
}
