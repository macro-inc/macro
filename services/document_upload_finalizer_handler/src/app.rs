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
    document_port: P,
    object_reader: O,
}

impl<P, O> DocumentUploadFinalizer<P, O> {
    /// Construct the upload finalization use case.
    pub fn new(document_port: P, object_reader: O) -> Self {
        Self {
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
        let document_key = match DocumentKey::from_s3_key(&event.key) {
            Ok(document_key) => document_key,
            Err(error) => {
                tracing::warn!(key=%event.key, error=?error, "skipping unparseable document storage key");
                return Ok(());
            }
        };

        let is_finalizable_key = matches!(
            document_key,
            DocumentKey::Versioned { .. } | DocumentKey::ConvertedPdf { .. }
        );
        if !is_finalizable_key {
            tracing::trace!(key=%event.key, ?document_key, "skipping non-finalizable document storage key");
            return Ok(());
        }

        let document_id = document_key.document_id().ok_or_else(|| {
            anyhow::anyhow!(
                "finalizable document key did not include a document id: {}",
                event.key
            )
        })?;

        let Some(document_context) = self.document_port.get_basic_document(document_id).await?
        else {
            tracing::warn!(%document_id, key=%event.key, "document storage object exists but document metadata does not");
            return Ok(());
        };

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
        let result = match document_key {
            DocumentKey::ConvertedPdf { .. } => {
                finalizer
                    .finalize_converted_pdf_document(&document_context)
                    .await
            }
            DocumentKey::Versioned { .. } => {
                finalizer
                    .finalize_uploaded_document(&document_context, markdown.as_deref())
                    .await
            }
            _ => unreachable!("non-finalizable keys returned earlier"),
        };

        match result {
            Ok(()) => {
                tracing::info!(%document_id, key=%event.key, "finalized document upload");
                Ok(())
            }
            Err(error) => Err(anyhow::anyhow!(error)),
        }
    }
}
