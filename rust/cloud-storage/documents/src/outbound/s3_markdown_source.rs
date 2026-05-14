//! S3 adapter for reading uploaded markdown source bytes.

use s3_key::build_cloud_storage_bucket_document_key;

use crate::domain::markdown_backfill::{
    MarkdownBackfillCandidate, MarkdownObjectReadError, MarkdownObjectReader,
};
use crate::outbound::s3_utf8_object_reader::{S3Utf8ObjectReadError, S3Utf8ObjectReader};

/// S3-backed markdown object reader.
#[derive(Clone)]
pub struct S3MarkdownObjectReader {
    bucket: String,
    utf8_reader: S3Utf8ObjectReader,
}

impl S3MarkdownObjectReader {
    /// Construct an S3 markdown reader for a document storage bucket.
    pub fn new(bucket: String, s3_client: aws_sdk_s3::Client) -> Self {
        Self {
            bucket,
            utf8_reader: S3Utf8ObjectReader::new(s3_client),
        }
    }
}

impl MarkdownObjectReader for S3MarkdownObjectReader {
    #[tracing::instrument(err, skip(self))]
    async fn read_markdown(
        &self,
        candidate: &MarkdownBackfillCandidate,
    ) -> Result<String, MarkdownObjectReadError> {
        let document_instance_id =
            candidate
                .document_instance_id
                .ok_or_else(|| MarkdownObjectReadError::Read {
                    key: "<missing-document-instance-id>".to_string(),
                    error: "candidate did not include a document instance id".to_string(),
                })?;

        let key = build_cloud_storage_bucket_document_key(
            &candidate.owner,
            &candidate.id,
            document_instance_id,
        );

        self.utf8_reader
            .read_utf8(&self.bucket, &key)
            .await
            .map_err(|error| match error {
                S3Utf8ObjectReadError::Missing => MarkdownObjectReadError::Missing { key },
                S3Utf8ObjectReadError::Read(error) => MarkdownObjectReadError::Read { key, error },
                S3Utf8ObjectReadError::InvalidUtf8(error) => {
                    MarkdownObjectReadError::InvalidUtf8 { key, error }
                }
            })
    }
}
