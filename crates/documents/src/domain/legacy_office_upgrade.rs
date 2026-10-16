//! Upgrading legacy binary Office uploads (`.doc`, `.ppt`, `.xls`) to their
//! OpenXML equivalents so they open in the native Word, PowerPoint, and
//! spreadsheet surfaces.
//!
//! The upgrade runs in two steps, both driven by object-created events:
//!
//! 1. When the legacy original lands, [`LegacyOfficeUpgrader::request_upgrade`]
//!    asks the conversion service to write `upgraded.{docx,pptx,xlsx}` next to
//!    it. The original stays ready, so the document is downloadable even if
//!    conversion fails.
//! 2. When the upgraded object lands, [`LegacyOfficeUpgrader::apply_upgrade`]
//!    makes it the document's current version and switches the file type.
//!    PowerPoint and Excel become a new document instance; Word becomes a new
//!    DOCX BOM staged for the regular DOCX pipeline.

use std::future::Future;

use model::document::{DocumentBasic, FileType};
use model_owner::Owner;

use super::content::{DocumentContent, DocumentContentLocation};
use super::models::DocumentError;

/// The OpenXML format a legacy binary Office type is upgraded to.
pub fn upgrade_target(file_type: FileType) -> Option<FileType> {
    match file_type {
        FileType::Doc => Some(FileType::Docx),
        FileType::Ppt => Some(FileType::Pptx),
        FileType::Xls => Some(FileType::Xlsx),
        _ => None,
    }
}

/// The legacy binary Office type an OpenXML format is upgraded from.
pub fn upgrade_source(target: FileType) -> Option<FileType> {
    match target {
        FileType::Docx => Some(FileType::Doc),
        FileType::Pptx => Some(FileType::Ppt),
        FileType::Xlsx => Some(FileType::Xls),
        _ => None,
    }
}

/// A request to convert a legacy original into its OpenXML equivalent.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LegacyOfficeUpgradeRequest {
    /// The document owner, which prefixes every object key.
    pub owner: Owner,
    /// The document being upgraded.
    pub document_id: String,
    /// The version holding the legacy original.
    pub source_version_id: i64,
    /// The legacy type.
    pub from: FileType,
    /// The OpenXML type.
    pub to: FileType,
}

/// Where the upgraded object is copied to become the document's content.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpgradedObjectDestination {
    /// A document instance in the document storage bucket.
    DocumentVersion {
        /// The new document instance id.
        version_id: i64,
    },
    /// A DOCX BOM in the DOCX staging bucket, picked up by the DOCX pipeline.
    DocxStaging {
        /// The new DOCX BOM id.
        bom_id: i64,
    },
}

/// Object storage and conversion capabilities for legacy upgrades.
pub trait LegacyOfficeUpgradeStoragePort: Send + Sync {
    /// Ask the conversion service to write the upgraded object.
    fn request_upgrade(
        &self,
        request: &LegacyOfficeUpgradeRequest,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// SHA-256 of the upgraded object, recorded on the new document instance.
    fn upgraded_object_sha(
        &self,
        owner: &Owner,
        document_id: &str,
        target: FileType,
    ) -> impl Future<Output = Result<String, DocumentError>> + Send;

    /// Copy the upgraded object to the destination that serves it.
    fn promote_upgraded_object(
        &self,
        owner: &Owner,
        document_id: &str,
        target: FileType,
        destination: UpgradedObjectDestination,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// Document persistence needed to swap in an upgraded version.
pub trait LegacyOfficeUpgradeRepoPort: Send + Sync {
    /// Insert a document instance (version) and return its id.
    fn create_document_instance(
        &self,
        document_id: &str,
        sha: &str,
    ) -> impl Future<Output = Result<i64, DocumentError>> + Send;

    /// Delete a document instance created for an upgrade that did not finish.
    fn delete_document_instance(
        &self,
        version_id: i64,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Insert a DOCX BOM (version) and return its id.
    fn create_document_bom(
        &self,
        document_id: &str,
    ) -> impl Future<Output = Result<i64, DocumentError>> + Send;

    /// Delete a DOCX BOM created for an upgrade that did not finish.
    fn delete_document_bom(
        &self,
        bom_id: i64,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;

    /// Change the document's file type from `from` to `to` if it is still
    /// `from`. Returns whether this call made the change.
    fn swap_document_file_type(
        &self,
        document_id: &str,
        from: FileType,
        to: FileType,
    ) -> impl Future<Output = Result<bool, DocumentError>> + Send;

    /// Persist content lifecycle metadata.
    fn set_document_content(
        &self,
        document_id: &str,
        content: DocumentContent,
    ) -> impl Future<Output = Result<(), DocumentError>> + Send;
}

/// What [`LegacyOfficeUpgrader::apply_upgrade`] did.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UpgradeOutcome {
    /// The upgraded object is now the document's content.
    Applied,
    /// The document is not (or no longer) the legacy source of this upgrade,
    /// e.g. a redelivered event after the upgrade already applied.
    Skipped,
}

/// Runs both steps of a legacy Office upgrade.
pub struct LegacyOfficeUpgrader<'a, R, S> {
    repo: &'a R,
    storage: &'a S,
}

impl<'a, R, S> LegacyOfficeUpgrader<'a, R, S>
where
    R: LegacyOfficeUpgradeRepoPort,
    S: LegacyOfficeUpgradeStoragePort,
{
    /// Construct an upgrader.
    pub fn new(repo: &'a R, storage: &'a S) -> Self {
        Self { repo, storage }
    }

    /// Request an upgrade when `version_id` holds a legacy Office original.
    /// Returns whether one was requested.
    #[tracing::instrument(skip(self, document_context), fields(document_id = %document_context.document_id), err)]
    pub async fn request_upgrade(
        &self,
        document_context: &DocumentBasic,
        version_id: i64,
    ) -> Result<bool, DocumentError> {
        let Some(from) = document_context.try_file_type() else {
            return Ok(false);
        };
        let Some(to) = upgrade_target(from) else {
            return Ok(false);
        };

        self.storage
            .request_upgrade(&LegacyOfficeUpgradeRequest {
                owner: document_context.owner.clone(),
                document_id: document_context.document_id.clone(),
                source_version_id: version_id,
                from,
                to,
            })
            .await?;
        Ok(true)
    }

    /// Make the upgraded `target` object the document's content.
    ///
    /// Safe to repeat: once applied, the file type no longer matches the
    /// legacy source and later calls skip. The file type is swapped before
    /// the object is copied so the copy's own object-created event sees the
    /// new type and does not request another upgrade.
    #[tracing::instrument(skip(self, document_context), fields(document_id = %document_context.document_id), err)]
    pub async fn apply_upgrade(
        &self,
        document_context: &DocumentBasic,
        target: FileType,
    ) -> Result<UpgradeOutcome, DocumentError> {
        let Some(source) = upgrade_source(target) else {
            return Err(DocumentError::BadRequest(format!(
                "{target} is not an upgrade target"
            )));
        };
        if document_context.try_file_type() != Some(source) {
            return Ok(UpgradeOutcome::Skipped);
        }

        match target {
            FileType::Docx => self.apply_docx_upgrade(document_context, source).await,
            _ => {
                self.apply_versioned_upgrade(document_context, source, target)
                    .await
            }
        }
    }

    async fn apply_versioned_upgrade(
        &self,
        document_context: &DocumentBasic,
        source: FileType,
        target: FileType,
    ) -> Result<UpgradeOutcome, DocumentError> {
        let document_id = &document_context.document_id;
        let owner = &document_context.owner;

        let sha = self
            .storage
            .upgraded_object_sha(owner, document_id, target)
            .await?;
        let version_id = self
            .repo
            .create_document_instance(document_id, &sha)
            .await?;

        if !self
            .repo
            .swap_document_file_type(document_id, source, target)
            .await?
        {
            self.repo.delete_document_instance(version_id).await?;
            return Ok(UpgradeOutcome::Skipped);
        }

        if let Err(error) = self
            .storage
            .promote_upgraded_object(
                owner,
                document_id,
                target,
                UpgradedObjectDestination::DocumentVersion { version_id },
            )
            .await
        {
            self.repo
                .swap_document_file_type(document_id, target, source)
                .await?;
            self.repo.delete_document_instance(version_id).await?;
            return Err(error);
        }

        self.repo
            .set_document_content(
                document_id,
                DocumentContent::ready(DocumentContentLocation::ObjectStorage),
            )
            .await?;
        Ok(UpgradeOutcome::Applied)
    }

    async fn apply_docx_upgrade(
        &self,
        document_context: &DocumentBasic,
        source: FileType,
    ) -> Result<UpgradeOutcome, DocumentError> {
        let document_id = &document_context.document_id;
        let owner = &document_context.owner;

        let bom_id = self.repo.create_document_bom(document_id).await?;

        if !self
            .repo
            .swap_document_file_type(document_id, source, FileType::Docx)
            .await?
        {
            self.repo.delete_document_bom(bom_id).await?;
            return Ok(UpgradeOutcome::Skipped);
        }

        // The DOCX pipeline marks the content ready once it has processed the
        // staged file, exactly as for a DOCX upload.
        self.repo
            .set_document_content(
                document_id,
                DocumentContent::pending_at(DocumentContentLocation::ConvertedPdf),
            )
            .await?;

        if let Err(error) = self
            .storage
            .promote_upgraded_object(
                owner,
                document_id,
                FileType::Docx,
                UpgradedObjectDestination::DocxStaging { bom_id },
            )
            .await
        {
            self.repo
                .swap_document_file_type(document_id, FileType::Docx, source)
                .await?;
            self.repo.delete_document_bom(bom_id).await?;
            self.repo
                .set_document_content(
                    document_id,
                    DocumentContent::ready(DocumentContentLocation::ObjectStorage),
                )
                .await?;
            return Err(error);
        }

        Ok(UpgradeOutcome::Applied)
    }
}

#[cfg(test)]
mod tests;
