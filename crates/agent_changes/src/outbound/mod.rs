//! Adapters implementing the changes ports for external systems.

/// Comparing a pushed branch on GitHub.
pub mod github_compare;
/// The summary row in Postgres.
pub mod postgres;
/// Drafting a pull request with the predefined fast model.
pub mod pull_request_draft;
/// Patch blobs in S3.
pub mod s3;
