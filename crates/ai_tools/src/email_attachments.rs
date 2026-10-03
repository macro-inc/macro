//! Composition of `SendEmail`'s attachment support: the documents domain as
//! the email domain's attachment source, S3 as its attachment store.
//!
//! The email crate defines the ports and the staged-send use case; it knows
//! nothing about documents. This module is the bridge, which is why it lives
//! in the composition root rather than in either domain crate.

use std::sync::Arc;

use documents::domain::{
    models::LocationQueryParams, ports::DocumentService, response::LocationResponseV3,
};
use email::domain::{
    models::{EmailErr, MAX_DRAFT_ATTACHMENTS_BYTES, SourcedAttachment},
    ports::{
        DraftAttachmentRepo, DraftAttachmentSource, DraftSendService, EmailAttachmentSendService,
        NoOpEmailAttachmentSender,
    },
    service::attachments::DraftAttachmentSender,
};
use email::outbound::S3DraftAttachmentStorage;
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_env_var::maybe_env_var;
use model::document::{ContentType, FileType};

maybe_env_var! {
    /// The bucket the email service stages draft attachments in. Shared
    /// with the email service, whose scheduled sender reads it.
    struct AttachmentBucket;
}

/// [`DraftAttachmentSource`] that resolves a document through the documents
/// domain and downloads the file it points at.
///
/// Only single-file documents attach: uploads such as PDFs, images, and
/// spreadsheets served from document storage. A Word document attaches as
/// its PDF rendering, the one single-file form the storage keeps of it. A
/// Macro-native document is sync-service content with no file, and is
/// refused with a reason the model can relay.
pub struct DocumentAttachmentSource<D> {
    documents: Arc<D>,
    http: reqwest::Client,
}

impl<D> DocumentAttachmentSource<D> {
    /// Resolve attachments through `documents`.
    pub fn new(documents: Arc<D>) -> Self {
        Self {
            documents,
            http: reqwest::Client::new(),
        }
    }
}

fn unavailable(name: &str, reason: impl Into<String>) -> EmailErr {
    EmailErr::AttachmentUnavailable {
        name: name.to_owned(),
        reason: reason.into(),
    }
}

/// The attachment's file name: the document's name with the extension of
/// what is actually attached, added when the stored name lacks it.
fn attachment_file_name(document_name: &str, extension: Option<&str>) -> String {
    let name = document_name.trim();
    let name = if name.is_empty() { "attachment" } else { name };
    match extension {
        Some(ext) if !name.to_ascii_lowercase().ends_with(&format!(".{ext}")) => {
            format!("{name}.{ext}")
        }
        _ => name.to_owned(),
    }
}

impl<D: DocumentService> DraftAttachmentSource for DocumentAttachmentSource<D> {
    #[tracing::instrument(skip_all, fields(document_id = %receipt.entity().entity_id), err)]
    async fn fetch_attachment(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<SourcedAttachment, EmailErr> {
        let document_id = receipt.entity().entity_id.to_string();
        // The receipt already proves view access; this read is the metadata
        // the location lookup needs.
        let basic = self
            .documents
            .internal_get_basic_document(&document_id)
            .await
            .map_err(|e| unavailable(&document_id, format!("it could not be found ({e})")))?;
        let name = basic.document_name.clone();
        let file_type = basic.try_file_type();

        let location = self
            .documents
            .get_document_location(
                &basic,
                receipt,
                LocationQueryParams {
                    document_version_id: None,
                    // A docx is stored as unzipped parts; its PDF rendering is
                    // the single file there is to attach.
                    get_converted_docx_url: Some(true),
                },
            )
            .await
            .map_err(|e| unavailable(&name, format!("its file could not be located ({e})")))?;

        let presigned_url = match location {
            // The location is browser-facing; a server-side fetch on the
            // local stack must reach LocalStack directly (a no-op elsewhere).
            LocationResponseV3::PresignedUrl { presigned_url, .. } => {
                macro_aws_config::transform_aws_url_for_internal_fetch(&presigned_url)
            }
            LocationResponseV3::PresignedUrls { .. }
            | LocationResponseV3::SyncServiceContent { .. } => {
                return Err(unavailable(
                    &name,
                    "it is a Macro document rather than an uploaded file; link to it in the email instead",
                ));
            }
        };

        let (attached_type, extension) = match file_type {
            Some(FileType::Docx) => (Some(FileType::Pdf), Some("pdf")),
            other => (other, other.as_ref().map(FileType::as_str)),
        };

        let mut response =
            self.http.get(&presigned_url).send().await.map_err(|e| {
                unavailable(&name, format!("its file could not be downloaded ({e})"))
            })?;
        if !response.status().is_success() {
            return Err(unavailable(
                &name,
                format!(
                    "its file could not be downloaded (HTTP {})",
                    response.status()
                ),
            ));
        }
        let header_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|v| v.split(';').next().unwrap_or(v).trim().to_ascii_lowercase())
            .filter(|v| {
                !v.is_empty() && v != "application/octet-stream" && v != "binary/octet-stream"
            });

        let mut bytes = Vec::new();
        loop {
            let chunk = response.chunk().await.map_err(|e| {
                unavailable(&name, format!("its file could not be downloaded ({e})"))
            })?;
            let Some(chunk) = chunk else { break };
            bytes.extend_from_slice(&chunk);
            if bytes.len() > MAX_DRAFT_ATTACHMENTS_BYTES {
                return Err(EmailErr::AttachmentsTooLarge {
                    total_bytes: bytes.len(),
                    limit_bytes: MAX_DRAFT_ATTACHMENTS_BYTES,
                });
            }
        }

        let content_type =
            header_type.unwrap_or_else(|| ContentType::from(attached_type).mime_type().to_owned());

        Ok(SourcedAttachment {
            file_name: attachment_file_name(&name, extension),
            content_type,
            bytes,
        })
    }
}

/// The sender `SendEmail` finishes through on a host with the attachment
/// bucket configured (`ATTACHMENT_BUCKET`), or one that refuses attachments
/// when it is not, so the host still boots and plain sends still work.
pub async fn build_email_attachment_sender<Svc, R, D>(
    email_service: Arc<Svc>,
    repo: R,
    documents: Arc<D>,
) -> Arc<dyn EmailAttachmentSendService>
where
    Svc: DraftSendService,
    R: DraftAttachmentRepo,
    D: DocumentService,
    anyhow::Error: From<R::Err>,
{
    let bucket = AttachmentBucket::new()
        .as_ref()
        .and_then(|bucket| bucket.value())
        .map(|bucket| bucket.trim().to_owned())
        .filter(|bucket| !bucket.is_empty());
    let Some(bucket) = bucket else {
        tracing::warn!("ATTACHMENT_BUCKET is not set; SendEmail attachments are disabled");
        return Arc::new(NoOpEmailAttachmentSender(email_service));
    };
    let storage = S3DraftAttachmentStorage::new(macro_aws_config::s3_client().await, bucket);
    Arc::new(DraftAttachmentSender::new(
        email_service,
        repo,
        DocumentAttachmentSource::new(documents),
        storage,
    ))
}

#[cfg(test)]
mod test {
    use super::attachment_file_name;

    #[test]
    fn appends_the_extension_when_the_name_lacks_it() {
        assert_eq!(
            attachment_file_name("Q3 report", Some("pdf")),
            "Q3 report.pdf"
        );
    }

    #[test]
    fn keeps_a_name_that_already_carries_the_extension() {
        assert_eq!(attachment_file_name("photo.PNG", Some("png")), "photo.PNG");
    }

    #[test]
    fn a_blank_name_still_yields_a_file_name() {
        assert_eq!(attachment_file_name("  ", Some("pdf")), "attachment.pdf");
        assert_eq!(attachment_file_name("", None), "attachment");
    }
}
