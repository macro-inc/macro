//! Outbound adapters for GitHub pull request storage.

pub mod pg_github_pull_request_repo;
#[cfg(feature = "s3")]
pub mod s3_patch_store;
