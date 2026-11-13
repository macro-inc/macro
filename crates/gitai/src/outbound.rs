/// [`crate::domain::ports::IndexStore`] on one DynamoDB table.
pub mod dynamodb;
/// [`crate::domain::ports::IngestMetrics`] as OTLP counters.
pub mod otel_metrics;
/// [`crate::domain::ports::ObjectStore`] on the events and sessions buckets.
pub mod s3;
