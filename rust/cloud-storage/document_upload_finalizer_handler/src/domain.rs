use documents::domain::models::DocumentError;
use documents::domain::ports::markdown::MarkdownInitializationPort;
use documents::domain::upload_finalize::{UploadFinalizeDocumentPort, UploadedDocumentFinalizer};
use model::document::FileType;
use s3_key::DocumentKey;

use crate::ports::{DocumentObjectReader, DocumentUploadMetadataPort};

/// Storage object-created event normalized at the inbound adapter boundary.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObjectCreated {
    /// S3 bucket name.
    pub bucket: String,
    /// S3 object key.
    pub key: String,
}

/// Application use case for finalizing document uploads from object-created events.
pub struct DocumentUploadFinalizer<P, O> {
    document_storage_bucket: String,
    document_port: P,
    object_reader: O,
}

impl<P, O> DocumentUploadFinalizer<P, O> {
    /// Construct the upload finalization use case.
    pub fn new(document_storage_bucket: String, document_port: P, object_reader: O) -> Self {
        Self {
            document_storage_bucket,
            document_port,
            object_reader,
        }
    }
}

impl<P, O> DocumentUploadFinalizer<P, O>
where
    P: DocumentUploadMetadataPort + UploadFinalizeDocumentPort,
    O: DocumentObjectReader,
{
    /// Handle one object-created event.
    #[tracing::instrument(skip(self, markdown_initializer), err)]
    pub async fn handle_object_created<M>(
        &self,
        event: ObjectCreated,
        markdown_initializer: &M,
    ) -> Result<(), anyhow::Error>
    where
        M: MarkdownInitializationPort,
    {
        if event.bucket != self.document_storage_bucket {
            tracing::trace!(
                bucket=%event.bucket,
                expected=%self.document_storage_bucket,
                key=%event.key,
                "skipping S3 event for another bucket"
            );
            return Ok(());
        }

        let document_key = match DocumentKey::from_s3_key(&event.key) {
            Ok(document_key) => document_key,
            Err(error) => {
                tracing::warn!(key=%event.key, error=?error, "skipping unparseable document storage key");
                return Ok(());
            }
        };

        if !matches!(document_key, DocumentKey::Versioned { .. }) {
            tracing::trace!(key=%event.key, ?document_key, "skipping non-versioned document storage key");
            return Ok(());
        }

        let document_id = document_key.document_id().ok_or_else(|| {
            anyhow::anyhow!(
                "versioned document key did not include a document id: {}",
                event.key
            )
        })?;

        let Some(document_context) = self.document_port.get_basic_document(document_id).await?
        else {
            tracing::warn!(%document_id, key=%event.key, "document storage object exists but document metadata does not");
            return Ok(());
        };

        if document_context.deleted_at.is_some() {
            tracing::trace!(%document_id, key=%event.key, "skipping deleted document");
            return Ok(());
        }

        let markdown = if matches!(document_context.try_file_type(), Some(FileType::Md)) {
            Some(
                self.object_reader
                    .read_utf8_object(&event.bucket, &event.key)
                    .await?,
            )
        } else {
            None
        };

        let finalizer = UploadedDocumentFinalizer::new(&self.document_port, markdown_initializer);
        match finalizer
            .finalize_uploaded_document(&document_context, markdown.as_deref())
            .await
        {
            Ok(()) => {
                tracing::info!(%document_id, key=%event.key, "finalized document upload");
                Ok(())
            }
            Err(DocumentError::BadRequest(error)) => {
                tracing::warn!(%document_id, key=%event.key, %error, "document upload could not be finalized");
                Ok(())
            }
            Err(error) => Err(anyhow::anyhow!(error)),
        }
    }
}
