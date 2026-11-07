//! Port definitions for the cal.com integration.

use std::future::Future;

use rootcause::Report;

use crate::domain::models::{BookingCreated, CalError, CalWebhookEvent};

/// Service that validates and processes cal.com webhook events.
///
/// The inbound HTTP adapter drives this trait.
pub trait CalWebhookService: Send + Sync + 'static {
    /// Verify the HMAC signature on a webhook body and parse its event.
    ///
    /// Returns [`CalError::InvalidWebhookSignature`] on signature mismatch
    /// and [`CalError::InvalidPayload`] when the body is not valid JSON.
    fn validate_webhook_event(
        &self,
        signature: &str,
        body: &[u8],
    ) -> impl Future<Output = Result<CalWebhookEvent, CalError>> + Send;

    /// Dispatch a validated webhook event to the configured analytics sink.
    fn process_webhook_event(
        &self,
        event: &CalWebhookEvent,
    ) -> impl Future<Output = Result<(), CalError>> + Send;
}

/// Outbound port: fires analytics events produced by the cal.com domain.
///
/// Implementations live under [`crate::outbound`]; the default adapter wraps
/// `analytics_client::AnalyticsClient`.
pub trait AnalyticsSink: Send + Sync + 'static {
    /// Track a `BOOKING_CREATED` event.
    ///
    /// `content_name` and `value` are resolved from the booking's `eventTypeId`
    /// by the service layer — see
    /// [`crate::domain::service::CalConfig::event_type_meta`]. `value` is in
    /// USD and is emitted on the Meta Lead so Value Optimization can weigh
    /// different booking types differently.
    fn on_booking_created(
        &self,
        booking: &BookingCreated,
        content_name: &str,
        value: f64,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
