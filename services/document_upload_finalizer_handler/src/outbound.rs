use documents::domain::content::DocumentContent;
use documents::domain::legacy_office_upgrade::{
    LegacyOfficeUpgradeRepoPort, LegacyOfficeUpgradeRequest, LegacyOfficeUpgradeStoragePort,
    UpgradedObjectDestination,
};
use documents::domain::models::DocumentError;
use documents::domain::upload_finalize::{RepoUploadFinalizePort, UploadFinalizeDocumentPort};
use documents::outbound::pg_document_repo::PgDocumentRepo;
use documents::outbound::s3_utf8_object_reader::S3Utf8ObjectReader;
use entity_registry::BotFacts;
use model::convert::ConvertQueueMessage;
use model::document::{DocumentBasic, FileType};
use model_owner::Owner;
use s3_key::{
    UpgradedOfficeFormat, build_cloud_storage_bucket_document_key,
    build_docx_staging_bucket_document_key, build_upgraded_office_document_key,
    document_key_url_path,
};
use sha2::{Digest, Sha256};

use crate::ports::{DocumentObjectReader, DocumentUploadMetadataPort};

/// S3-backed object reader for uploaded document bytes.
#[derive(Clone)]
pub struct S3DocumentObjectReader {
    utf8_reader: S3Utf8ObjectReader,
}

impl S3DocumentObjectReader {
    /// Construct an S3 object reader.
    pub fn new(s3_client: aws_sdk_s3::Client) -> Self {
        Self {
            utf8_reader: S3Utf8ObjectReader::new(s3_client),
        }
    }
}

impl DocumentObjectReader for S3DocumentObjectReader {
    async fn read_utf8_object(&self, bucket: &str, key: &str) -> Result<String, anyhow::Error> {
        self.utf8_reader
            .read_utf8(bucket, key)
            .await
            .map_err(|error| {
                anyhow::anyhow!("failed to read upload from s3://{bucket}/{key}: {error:?}")
            })
    }
}

/// Postgres-backed document port for upload finalization.
#[derive(Clone)]
pub struct PgDocumentUploadPort<B> {
    repo: PgDocumentRepo<B>,
}

impl<B> PgDocumentUploadPort<B> {
    /// Construct a Postgres document upload port.
    pub fn new(repo: PgDocumentRepo<B>) -> Self {
        Self { repo }
    }
}

impl<B: BotFacts + Clone + 'static> DocumentUploadMetadataPort for PgDocumentUploadPort<B> {
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

impl<B: BotFacts + Clone + 'static> UploadFinalizeDocumentPort for PgDocumentUploadPort<B> {
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

impl<B: BotFacts + Clone + 'static> LegacyOfficeUpgradeRepoPort for PgDocumentUploadPort<B> {
    async fn create_document_instance(
        &self,
        document_id: &str,
        sha: &str,
    ) -> Result<i64, DocumentError> {
        self.repo.create_document_instance(document_id, sha).await
    }

    async fn delete_document_instance(&self, version_id: i64) -> Result<(), DocumentError> {
        self.repo.delete_document_instance(version_id).await
    }

    async fn create_document_bom(&self, document_id: &str) -> Result<i64, DocumentError> {
        self.repo.create_document_bom(document_id).await
    }

    async fn delete_document_bom(&self, bom_id: i64) -> Result<(), DocumentError> {
        self.repo.delete_document_bom(bom_id).await
    }

    async fn swap_document_file_type(
        &self,
        document_id: &str,
        from: FileType,
        to: FileType,
    ) -> Result<bool, DocumentError> {
        self.repo
            .swap_document_file_type(document_id, from, to)
            .await
    }

    async fn set_document_content(
        &self,
        document_id: &str,
        content: DocumentContent,
    ) -> Result<(), DocumentError> {
        LegacyOfficeUpgradeRepoPort::set_document_content(&self.repo, document_id, content).await
    }
}

/// S3 and convert-queue backed storage for legacy Office upgrades.
#[derive(Clone)]
pub struct S3LegacyOfficeUpgradeStorage {
    s3_client: aws_sdk_s3::Client,
    sqs_client: sqs_client::SQS,
    document_storage_bucket: String,
    docx_upload_bucket: String,
}

impl S3LegacyOfficeUpgradeStorage {
    /// Construct the upgrade storage adapter.
    pub fn new(
        s3_client: aws_sdk_s3::Client,
        sqs_client: sqs_client::SQS,
        document_storage_bucket: String,
        docx_upload_bucket: String,
    ) -> Self {
        Self {
            s3_client,
            sqs_client,
            document_storage_bucket,
            docx_upload_bucket,
        }
    }
}

fn upgraded_format(target: FileType) -> Result<UpgradedOfficeFormat, DocumentError> {
    match target {
        FileType::Docx => Ok(UpgradedOfficeFormat::Docx),
        FileType::Pptx => Ok(UpgradedOfficeFormat::Pptx),
        FileType::Xlsx => Ok(UpgradedOfficeFormat::Xlsx),
        _ => Err(DocumentError::BadRequest(format!(
            "{target} is not an upgrade target"
        ))),
    }
}

fn storage_error(context: &str, error: impl std::fmt::Debug) -> DocumentError {
    DocumentError::Internal(anyhow::anyhow!("{context}: {error:?}"))
}

/// The convert-queue message that writes a legacy original's OpenXML upgrade.
pub fn upgrade_convert_message(
    request: &LegacyOfficeUpgradeRequest,
    document_storage_bucket: &str,
    job_id: String,
) -> Result<ConvertQueueMessage, DocumentError> {
    Ok(ConvertQueueMessage {
        job_id,
        from_bucket: document_storage_bucket.to_string(),
        to_bucket: document_storage_bucket.to_string(),
        from_key: build_cloud_storage_bucket_document_key(
            &request.owner,
            &request.document_id,
            request.source_version_id,
        ),
        to_key: build_upgraded_office_document_key(
            &request.owner,
            &request.document_id,
            upgraded_format(request.to)?,
        ),
        // Versioned keys have no extension, so the types travel explicitly.
        from_file_type: Some(request.from),
        to_file_type: Some(request.to),
    })
}

/// The bucket and key an upgraded object is copied to.
pub fn upgraded_object_destination(
    owner: &Owner,
    document_id: &str,
    destination: UpgradedObjectDestination,
    document_storage_bucket: &str,
    docx_upload_bucket: &str,
) -> (String, String) {
    match destination {
        UpgradedObjectDestination::DocumentVersion { version_id } => (
            document_storage_bucket.to_string(),
            build_cloud_storage_bucket_document_key(owner, document_id, version_id),
        ),
        UpgradedObjectDestination::DocxStaging { bom_id } => (
            docx_upload_bucket.to_string(),
            build_docx_staging_bucket_document_key(owner, document_id, bom_id),
        ),
    }
}

impl LegacyOfficeUpgradeStoragePort for S3LegacyOfficeUpgradeStorage {
    async fn request_upgrade(
        &self,
        request: &LegacyOfficeUpgradeRequest,
    ) -> Result<(), DocumentError> {
        let message = upgrade_convert_message(
            request,
            &self.document_storage_bucket,
            macro_uuid::generate_uuid_v7().to_string(),
        )?;
        self.sqs_client
            .enqueue_convert_queue_message(message)
            .await
            .map_err(|error| storage_error("failed to enqueue legacy office upgrade", error))
    }

    async fn upgraded_object_sha(
        &self,
        owner: &Owner,
        document_id: &str,
        target: FileType,
    ) -> Result<String, DocumentError> {
        let key = build_upgraded_office_document_key(owner, document_id, upgraded_format(target)?);
        let object = self
            .s3_client
            .get_object()
            .bucket(&self.document_storage_bucket)
            .key(&key)
            .send()
            .await
            .map_err(|error| storage_error("failed to read upgraded office object", error))?;
        let bytes = object
            .body
            .collect()
            .await
            .map_err(|error| storage_error("failed to read upgraded office object", error))?
            .into_bytes();
        Ok(format!("{:x}", Sha256::digest(&bytes)))
    }

    async fn promote_upgraded_object(
        &self,
        owner: &Owner,
        document_id: &str,
        target: FileType,
        destination: UpgradedObjectDestination,
    ) -> Result<(), DocumentError> {
        let source_key =
            build_upgraded_office_document_key(owner, document_id, upgraded_format(target)?);
        let (bucket, key) = upgraded_object_destination(
            owner,
            document_id,
            destination,
            &self.document_storage_bucket,
            &self.docx_upload_bucket,
        );
        self.s3_client
            .copy_object()
            .copy_source(format!(
                "{}/{}",
                self.document_storage_bucket,
                document_key_url_path(&source_key)
            ))
            .bucket(bucket)
            .key(key)
            .content_type(target.mime_type())
            .metadata_directive(aws_sdk_s3::types::MetadataDirective::Replace)
            .send()
            .await
            .map_err(|error| storage_error("failed to copy upgraded office object", error))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
