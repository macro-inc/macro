//! [`AnalyticsSink`](crate::domain::ports::AnalyticsSink) adapter over
//! `analytics_client::AnalyticsClient`.
//!
//! For `BOOKING_CREATED` this fires a Meta "Lead" event keyed on the first
//! attendee's email. `content_name` is resolved by the service from the
//! booking's `eventTypeId`.

use std::sync::Arc;

use analytics_client::{AnalyticsClient, MetaActionSource, MetaUserData};
use rootcause::Report;
use serde::Serialize;

use crate::domain::models::BookingCreated;
use crate::domain::ports::AnalyticsSink;

/// Analytics sink backed by `analytics_client::AnalyticsClient`.
pub struct AnalyticsClientSink {
    client: Arc<AnalyticsClient>,
}

impl AnalyticsClientSink {
    /// Construct a new sink from a shared analytics client.
    pub fn new(client: Arc<AnalyticsClient>) -> Self {
        Self { client }
    }
}

#[derive(Debug, Serialize)]
struct LeadCustomData<'a> {
    content_name: &'a str,
    content_category: &'static str,
    value: f64,
    currency: &'static str,
}

impl AnalyticsSink for AnalyticsClientSink {
    #[tracing::instrument(
        err,
        skip(self, booking),
        fields(uid = %booking.uid, content_name, value),
    )]
    async fn on_booking_created(
        &self,
        booking: &BookingCreated,
        content_name: &str,
        value: f64,
    ) -> Result<(), Report> {
        let attendee_email = booking.attendees.first().map(|a| a.email.as_str());

        // Attribution signals passed through from the marketing site via
        // `?metadata[...]=` URL params (link flow) or `config.metadata` on
        // the cal embed (embed flow). Without these, Meta can only match on
        // hashed email, which is why the custom-conversion counter wasn't
        // moving for real bookings.
        let metadata = &booking.metadata;

        let user_data = MetaUserData {
            email: attendee_email.map(str::to_string),
            fbp: metadata
                .get("fbp")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            fbc: metadata
                .get("fbc")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            client_user_agent: metadata
                .get("user_agent")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            ..MetaUserData::default()
        };

        let custom_data = LeadCustomData {
            content_name,
            content_category: "cal_booking",
            value,
            currency: "USD",
        };

        // Debug log so we can see whether cal.com's metadata passthrough is
        // carrying the browser attribution signals. Only presence flags and
        // metadata key names are emitted — the raw email, fbp/fbc values,
        // and user_agent are deliberately not logged to avoid PII leakage.
        // Enable with `RUST_LOG=cal=debug` when investigating match quality
        tracing::debug!(
            uid = %booking.uid,
            content_name = %content_name,
            metadata_keys = ?metadata.keys().collect::<Vec<_>>(),
            has_email = user_data.email.is_some(),
            has_fbp = user_data.fbp.is_some(),
            has_fbc = user_data.fbc.is_some(),
            has_client_user_agent = user_data.client_user_agent.is_some(),
            "preparing meta Lead from cal BOOKING_CREATED"
        );

        self.client
            .track_meta(
                "CompleteRegistration",
                &user_data,
                MetaActionSource::Website,
                Some(&booking.uid),
                &custom_data,
            )
            .await
            .map_err(|e| rootcause::report!("meta track failed: {e}"))?;

        Ok(())
    }
}
