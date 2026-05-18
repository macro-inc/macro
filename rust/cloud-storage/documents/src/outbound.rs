//! Outbound adapters for the documents domain.

#[cfg(feature = "document_create_adapters")]
pub mod document_bytes_upload;
#[cfg(feature = "markdown_init")]
pub mod markdown_init;
#[cfg(feature = "outbound")]
pub mod pg_document_repo;
#[cfg(feature = "outbound")]
pub mod s3_markdown_source;
#[cfg(feature = "outbound")]
pub mod s3_upload_url;
#[cfg(feature = "outbound")]
pub mod s3_utf8_object_reader;
#[cfg(feature = "outbound")]
pub mod sync_service_probe;
