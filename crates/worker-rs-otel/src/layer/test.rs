use tracing_subscriber::layer::SubscriberExt;

use super::{OtelLayer, traceparent_for_span};
use crate::parse_traceparent;

#[test]
fn creates_traceparent_for_managed_span() {
    let subscriber = tracing_subscriber::registry().with(OtelLayer::new("test-service"));
    let dispatch = tracing::Dispatch::new(subscriber);

    tracing::dispatcher::with_default(&dispatch, || {
        let span = tracing::info_span!("outbound.request");
        let traceparent = traceparent_for_span(&span).expect("managed span context");
        assert!(parse_traceparent(&traceparent).is_some());
        assert!(traceparent.ends_with("-01"));
    });
}
