//! Durable request event delivery; start one driver per service replica.
use crate::domain::ports::{RequestEventSink, RequestRepository};
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// Retry committed events until the notification and realtime sinks accept them.
pub async fn run<R: RequestRepository, S: RequestEventSink>(
    repository: Arc<R>,
    sink: S,
    cancellation: CancellationToken,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(2));
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => return,
            _ = interval.tick() => {},
        }
        let events = match repository.claim_events().await {
            Ok(events) => events,
            Err(error) => {
                tracing::error!(error=?error, "could not claim access request events");
                continue;
            }
        };
        for event in events {
            if cancellation.is_cancelled() {
                return;
            }
            let span = tracing::info_span!("access_requests.deliver", event_id = %event.id, entity_id = %event.entity.entity_id);
            let parent = opentelemetry::global::get_text_map_propagator(|propagator| {
                propagator.extract(&event.trace_context)
            });
            let _ = span.set_parent(parent);
            if let Err(error) = sink.deliver(&event).instrument(span).await {
                tracing::error!(error=?error, event_id=%event.id, "access request delivery will retry");
                continue;
            }
            if let Err(error) = repository.delivered(event.id).await {
                tracing::error!(error=?error, event_id=%event.id, "could not complete access request delivery");
            }
        }
    }
}
