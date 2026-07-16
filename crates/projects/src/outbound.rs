//! Outbound adapters for the projects domain.

/// DynamoDB bulk-upload request adapter.
pub mod dynamo_bulk_upload;
/// S3 project-upload URL adapter.
pub mod s3_upload_urls;
/// Redis content-hash counter adapter.
pub mod sha_counter;
/// SQS project search-index adapter.
pub mod sqs_search_indexer;

pub use dynamo_bulk_upload::DynamoBulkUploadAdapter;
pub use s3_upload_urls::S3ProjectUploadAdapter;
pub use sha_counter::ShaCountAdapter;
pub use sqs_search_indexer::SqsProjectSearchIndexer;
