//! Adapters implementing the changes ports for external systems.

/// Reading a linked pull request on GitHub.
pub mod github_pull_request;
/// The summary row in Postgres.
pub mod postgres;
/// Patch blobs in S3.
pub mod s3;
