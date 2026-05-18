#![deny(missing_docs)]

//! S3 key building and parsing for cloud storage buckets.

mod document_key;
pub use document_key::{
    CONVERTED_DOCUMENT_FILE_NAME, DOCX_EXTENSION, DocumentKey, PDF_EXTENSION, TEMP_FILE_PREFIX,
    build_cloud_storage_bucket_document_key, build_docx_staging_bucket_document_key,
    build_docx_to_pdf_converted_document_key, build_temp_docx_key,
};
mod bulk_upload_key;
pub use bulk_upload_key::BulkUploadStagingKey;
mod static_file_key;
pub use static_file_key::StaticFileKey;
