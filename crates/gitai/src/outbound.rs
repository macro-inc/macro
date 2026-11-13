/// [`crate::domain::ports::IndexStore`] on one DynamoDB table.
pub mod dynamodb;
/// [`crate::domain::read::ports::ReadIndex`] on the same table.
pub mod dynamodb_read;
/// [`crate::domain::read::ports::GithubApi`] on GitHub's REST and GraphQL APIs.
pub mod github;
/// [`crate::domain::ports::IngestMetrics`] as OTLP counters.
pub mod otel_metrics;
/// [`crate::domain::ports::ObjectStore`] on the events and sessions buckets.
pub mod s3;
