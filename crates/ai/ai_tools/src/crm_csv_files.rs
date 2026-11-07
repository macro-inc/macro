//! The documents domain as the CRM's CSV files: what the CSV import tools
//! read and the pipeline export saves.
//!
//! The crm crate defines the [`CsvFiles`] port and knows nothing about
//! documents; this bridge lives in the composition root, like
//! [`crate::email_attachments`].

use std::sync::Arc;
use std::time::Duration;

use crm::domain::crm_csv::MAX_CSV_BYTES;
use crm::domain::crm_transfer::{CsvFile, CsvFiles, TransferError};
use databases::domain::models::Viewer;
use documents::domain::{
    create::{NewDocumentMetadata, NewPlainTextDocument},
    models::LocationQueryParams,
    ports::{DocumentService, create::DocumentCreationService},
    response::LocationResponseV3,
};
use documents::inbound::toolset::DefaultDocumentToolCreator;
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use model::document::FileType;
use model_owner::CreationPrincipal;
use uuid::Uuid;

/// How long one CSV download may take, body included.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// [`CsvFiles`] over Macro documents: CSV uploads in, CSV documents out.
pub struct DocumentCsvFiles<D: DocumentService + DocumentCreationService, A> {
    documents: Arc<D>,
    creator: DefaultDocumentToolCreator<D>,
    access: Arc<A>,
    http: reqwest::Client,
}

impl<D: DocumentService + DocumentCreationService, A> DocumentCsvFiles<D, A> {
    /// CSV files through `documents`, created with `creator`, authorized by `access`.
    pub fn new(documents: Arc<D>, creator: DefaultDocumentToolCreator<D>, access: Arc<A>) -> Self {
        Self {
            documents,
            creator,
            access,
            http: reqwest::Client::new(),
        }
    }
}

fn unreadable(reason: impl std::fmt::Display) -> TransferError {
    TransferError::File(format!("The CSV file could not be read: {reason}."))
}

impl<D, A> CsvFiles for DocumentCsvFiles<D, A>
where
    D: DocumentService + DocumentCreationService,
    A: EntityAccessService,
{
    #[tracing::instrument(skip_all, fields(document_id = %document), err)]
    async fn read(&self, viewer: &Viewer, document: Uuid) -> Result<CsvFile, TransferError> {
        let document_id = document.to_string();
        let receipt = self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &viewer.user_id,
                None,
                &document_id,
                EntityType::Document,
            )
            .await
            .map_err(|_| {
                TransferError::File(
                    "No CSV file with that documentId exists for this user.".to_owned(),
                )
            })?;
        let basic = self
            .documents
            .internal_get_basic_document(&document_id)
            .await
            .map_err(unreadable)?;
        if !matches!(basic.try_file_type(), Some(FileType::Csv | FileType::Txt)) {
            return Err(TransferError::File(format!(
                "\"{}\" is not a CSV file; pass a .csv upload, or the CSV text in csv.",
                basic.document_name
            )));
        }
        let location = self
            .documents
            .get_document_location(
                &basic,
                receipt,
                LocationQueryParams {
                    document_version_id: None,
                    get_converted_docx_url: None,
                },
            )
            .await
            .map_err(unreadable)?;
        let LocationResponseV3::PresignedUrl { presigned_url, .. } = location else {
            return Err(unreadable("it is not a single uploaded file"));
        };
        // The location is browser-facing; a server-side fetch on the local
        // stack must reach LocalStack directly (a no-op elsewhere).
        let url = macro_aws_config::transform_aws_url_for_internal_fetch(&presigned_url);
        let response = self
            .http
            .get(&url)
            .timeout(DOWNLOAD_TIMEOUT)
            .send()
            .await
            .map_err(unreadable)?;
        if !response.status().is_success() {
            return Err(unreadable(format!(
                "download failed with {}",
                response.status()
            )));
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_CSV_BYTES as u64)
        {
            return Err(TransferError::File(format!(
                "The CSV file is larger than {} MB.",
                MAX_CSV_BYTES / (1024 * 1024)
            )));
        }
        let bytes = response.bytes().await.map_err(unreadable)?;
        let text =
            String::from_utf8(bytes.to_vec()).map_err(|_| unreadable("it is not UTF-8 text"))?;
        Ok(CsvFile {
            name: basic.document_name,
            text,
        })
    }

    #[tracing::instrument(skip_all, err)]
    async fn save(&self, viewer: &Viewer, name: &str, text: String) -> Result<Uuid, TransferError> {
        let principal = match viewer.acting_bot {
            Some(bot) => CreationPrincipal::BotForUser {
                bot,
                user: viewer.user_id.clone(),
            },
            None => CreationPrincipal::User(viewer.user_id.clone()),
        };
        let document =
            NewPlainTextDocument::builder(NewDocumentMetadata::builder(name.to_owned()).build())
                .file_type(FileType::Csv)
                .text(text)
                .build()
                .map_err(|error| {
                    TransferError::File(format!("The CSV file could not be saved: {error}."))
                })?;
        let created = self
            .creator
            .create_plain_text(&principal, document)
            .await
            .map_err(|error| {
                TransferError::File(format!("The CSV file could not be saved: {error}."))
            })?;
        let id = created
            .into_response()
            .document_response
            .document_metadata
            .metadata
            .document_id;
        id.to_string()
            .parse()
            .map_err(|_| TransferError::File("The saved CSV file has no valid id.".to_owned()))
    }
}
