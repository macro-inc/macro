//! W3C trace context carried on contacts queue messages, so the worker round
//! that applies a message joins the trace of the request that sent it.

#[cfg(all(test, feature = "outbound"))]
pub(crate) mod capture;

use opentelemetry::trace::TraceContextExt as _;
use std::collections::HashMap;
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

/// SQS string attribute carrying a W3C traceparent. Older workers ignore it.
pub(crate) const ATTRIBUTE: &str = "traceparent";

/// The current span's traceparent as an SQS message attribute, if it has a
/// valid context.
#[cfg(feature = "outbound")]
pub(crate) fn attribute() -> Option<aws_sdk_sqs::types::MessageAttributeValue> {
    let context = tracing::Span::current().context();
    if !context.span().span_context().is_valid() {
        return None;
    }
    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut carrier);
    });
    aws_sdk_sqs::types::MessageAttributeValue::builder()
        .data_type("String")
        .string_value(carrier.remove(ATTRIBUTE)?)
        .build()
        .ok()
}

/// Parents `span` on the sender recorded in `message`. A message without a
/// valid traceparent leaves `span` where it is.
#[cfg(feature = "inbound")]
pub(crate) fn adopt(span: &tracing::Span, message: &aws_sdk_sqs::types::Message) {
    let Some(traceparent) = message
        .message_attributes()
        .and_then(|attributes| attributes.get(ATTRIBUTE))
        .and_then(|attribute| attribute.string_value())
    else {
        return;
    };
    let carrier = HashMap::from([(ATTRIBUTE.to_owned(), traceparent.to_owned())]);
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &carrier)
    });
    if context.span().span_context().is_valid() {
        let _ = span.set_parent(context);
    }
}
