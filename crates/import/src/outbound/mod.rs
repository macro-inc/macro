//! Outbound adapters for import persistence, notifications, and entity enrichment.

pub mod document_properties;
pub mod gateway_notifier;
pub mod linear_api_source;
pub mod mcp_slack_source;
pub mod notion_api_source;
pub mod pg_import_repo;
pub mod static_file_image_rehoster;

#[cfg(test)]
mod direct_api;
