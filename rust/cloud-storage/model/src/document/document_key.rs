pub const CONVERTED_DOCUMENT_FILE_NAME: &str = "converted";
const TEMP_FILE_PREFIX: &str = "temp_files";
const PDF_EXTENSION: &str = "pdf";
const DOCX_EXTENSION: &str = "docx";

/// Builds a document key for a document in the cloud storage bucket.
/// The document_version_id could be the document's version id (i64) or "converted" for files that
/// are converted. Optionally appends a file extension to the key.
fn build_cloud_storage_bucket_document_key_helper<T: ToString>(
    user_id: &str,
    document_id: &str,
    document_version_id: T,
    file_type: Option<&str>,
) -> String {
    match file_type {
        Some(file_type) => {
            format!(
                "{}/{}/{}.{}",
                user_id,
                document_id,
                document_version_id.to_string(),
                file_type
            )
        }
        None => {
            format!(
                "{}/{}/{}",
                user_id,
                document_id,
                document_version_id.to_string()
            )
        }
    }
}

/// Builds a document key for a document in the cloud storage bucket.
/// The format is `{user_id}/{document_id}/{document_version_id}`.
/// Note that some specific document use cases will have a different format, see:
/// `build_docx_to_pdf_converted_document_key`, `build_docx_staging_bucket_document_key`, `build_temp_docx_key`.
pub fn build_cloud_storage_bucket_document_key<T: ToString>(
    user_id: &str,
    document_id: &str,
    document_version_id: T,
) -> String {
    build_cloud_storage_bucket_document_key_helper(user_id, document_id, document_version_id, None)
}

/// Builds the S3 key for a converted DOCX document's PDF output.
/// Format: `{user_id}/{document_id}/converted.pdf`
pub fn build_docx_to_pdf_converted_document_key(user_id: &str, document_id: &str) -> String {
    build_cloud_storage_bucket_document_key_helper(
        user_id,
        document_id,
        CONVERTED_DOCUMENT_FILE_NAME,
        Some(PDF_EXTENSION),
    )
}

/// Builds the S3 key for a DOCX document's staging bucket.
/// Format: `{user_id}/{document_id}/{document_version_id}.docx`
pub fn build_docx_staging_bucket_document_key(
    user_id: &str,
    document_id: &str,
    document_version_id: i64,
) -> String {
    build_cloud_storage_bucket_document_key_helper(
        user_id,
        document_id,
        document_version_id,
        Some(DOCX_EXTENSION),
    )
}

/// Builds the S3 key for a temporary DOCX export file.
/// Format: `temp_files/{document_id}.docx`
pub fn build_temp_docx_key(document_id: &str) -> String {
    format!("{}/{}.{}", TEMP_FILE_PREFIX, document_id, DOCX_EXTENSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_cloud_storage_bucket_document_key() {
        let key = build_cloud_storage_bucket_document_key("owner", "document-id", 1);
        assert_eq!(key, "owner/document-id/1");
    }

    #[test]
    fn test_build_cloud_storage_bucket_document_key_helper() {
        let key =
            build_cloud_storage_bucket_document_key_helper("owner", "document-id", 1, Some("pdf"));
        assert_eq!(key, "owner/document-id/1.pdf");

        let key = build_cloud_storage_bucket_document_key_helper("owner", "document-id", 1, None);
        assert_eq!(key, "owner/document-id/1");
    }
}
