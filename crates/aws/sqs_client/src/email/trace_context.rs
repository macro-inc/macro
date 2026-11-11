//! Optional W3C context for email backfill jobs, including retries and fan-out.

/// SQS string attribute carrying a W3C traceparent. Older workers ignore it.
pub const ATTRIBUTE: &str = "traceparent";

pub(super) fn attribute() -> Option<aws_sdk_sqs::types::MessageAttributeValue> {
    traceparent::current().and_then(|value| {
        aws_sdk_sqs::types::MessageAttributeValue::builder()
            .data_type("String")
            .string_value(value)
            .build()
            .ok()
    })
}
