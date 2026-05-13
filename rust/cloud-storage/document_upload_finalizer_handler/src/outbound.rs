use anyhow::Context as _;
use documents::domain::content::DocumentContent;
use documents::domain::models::DocumentError;
use documents::domain::upload_finalize::{RepoUploadFinalizePort, UploadFinalizeDocumentPort};
use documents::outbound::pg_document_repo::PgDocumentRepo;
use model::document::DocumentBasic;

use crate::ports::{DocumentObjectReader, DocumentUploadMetadataPort};

/// S3-backed object reader for uploaded document bytes.
#[derive(Clone)]
pub struct S3DocumentObjectReader {
    s3_client: aws_sdk_s3::Client,
}

impl S3DocumentObjectReader {
    /// Construct an S3 object reader.
    pub fn new(s3_client: aws_sdk_s3::Client) -> Self {
        Self { s3_client }
    }
}

impl DocumentObjectReader for S3DocumentObjectReader {
    async fn read_utf8_object(&self, bucket: &str, key: &str) -> Result<String, anyhow::Error> {
        let response = self
            .s3_client
            .get_object()
            .bucket(bucket)
            .key(key)
            .send()
            .await
            .with_context(|| format!("failed to read upload from s3://{bucket}/{key}"))?;

        let bytes = response
            .body
            .collect()
            .await
            .context("failed to collect object body")?
            .into_bytes();

        String::from_utf8(bytes.to_vec())
            .with_context(|| format!("uploaded object is not valid utf-8: s3://{bucket}/{key}"))
    }
}

/// Postgres-backed document port for upload finalization.
#[derive(Clone)]
pub struct PgDocumentUploadPort {
    repo: PgDocumentRepo,
}

impl PgDocumentUploadPort {
    /// Construct a Postgres document upload port.
    pub fn new(repo: PgDocumentRepo) -> Self {
        Self { repo }
    }
}

impl DocumentUploadMetadataPort for PgDocumentUploadPort {
    async fn get_basic_document(
        &self,
        document_id: &str,
    ) -> Result<Option<DocumentBasic>, DocumentError> {
        match documents::domain::ports::DocumentRepo::get_basic_document(&self.repo, document_id)
            .await
        {
            Ok(document) => Ok(Some(document)),
            Err(sqlx::Error::RowNotFound) => Ok(None),
            Err(error) => Err(DocumentError::Internal(error.into())),
        }
    }
}

impl UploadFinalizeDocumentPort for PgDocumentUploadPort {
    async fn get_document_content(
        &self,
        document_context: &DocumentBasic,
    ) -> Result<DocumentContent, DocumentError> {
        RepoUploadFinalizePort::new(self.repo.clone())
            .get_document_content(document_context)
            .await
    }

    async fn mark_document_uploaded(&self, document_id: &str) -> Result<(), DocumentError> {
        RepoUploadFinalizePort::new(self.repo.clone())
            .mark_document_uploaded(document_id)
            .await
    }

    async fn set_document_content(
        &self,
        document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        RepoUploadFinalizePort::new(self.repo.clone())
            .set_document_content(document_id, content)
            .await
    }
}
