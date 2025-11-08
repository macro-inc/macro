pub static CONVERTED_DOCUMENT_FILE_NAME: &str = "converted";

/// Builds a document key for a document in the cloud storage bucket.
/// The document_version_id could be the document's version id (i64) or "converted" for files that
/// are converted.
pub fn build_cloud_storage_bucket_document_key<T: ToString>(
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

pub fn build_docx_staging_bucket_document_key(
    user_id: &str,
    document_id: &str,
    document_version_id: i64,
) -> String {
    format!("{}/{}/{}.docx", user_id, document_id, document_version_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_cloud_storage_bucket_document_key() {
        let key = build_cloud_storage_bucket_document_key("owner", "document-id", 1, Some("pdf"));
        assert_eq!(key, "owner/document-id/1.pdf");

        let key = build_cloud_storage_bucket_document_key("owner", "document-id", 1, None);
        assert_eq!(key, "owner/document-id/1");
    }
}
