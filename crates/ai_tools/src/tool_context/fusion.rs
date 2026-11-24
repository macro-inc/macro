//! Composition of `ImportFromFusion`: the Fusion import over the user's
//! `autodesk` connection, signed storage downloads, its MacroDB ledger, and
//! file documents made by the same creator the document tools use.

use super::*;
use bytes::Bytes;
use documents::domain::create::{NewDocumentMetadata, NonMarkdownFileType};
use documents::domain::models::DocumentError;
use documents::domain::ports::DocumentLifecycleReads as _;
use entity_access::domain::models::{AccessError, EditAccessLevel};
use fusion_import::domain::ports::{AddedVersion, CadDocuments, CreatedCad};
use fusion_import::domain::service::FusionImportService;
use fusion_import::inbound::toolset::FusionToolContext;
use fusion_import::outbound::aps::ConnectedAps;
use fusion_import::outbound::pg_repo::PgFusionRepo;
use fusion_import::outbound::rollout::FusionImportRollout;
use fusion_import::outbound::signed_download::HttpSignedDownloads;
use model_file_type::FileType;
use uuid::Uuid;

/// The Fusion import the tool calls.
pub type ToolFusionService = FusionImportService<
    ConnectedAps<connectors::Connectors>,
    HttpSignedDownloads,
    PgFusionRepo,
    FusionCadDocuments,
    FusionImportRollout<feature_flags::outbound::posthog::PostHogFeatureFlags>,
>;

/// Context of `ImportFromFusion`.
pub type ToolFusionToolContext = FusionToolContext<ToolFusionService>;

/// Why a Fusion document write failed.
#[derive(Debug, thiserror::Error)]
pub enum FusionDocumentsError {
    /// The documents service refused or failed.
    #[error(transparent)]
    Documents(#[from] DocumentError),
    /// The user may not edit the document.
    #[error("no edit access to the Fusion document: {0:?}")]
    Access(AccessError),
    /// Reading whether the document is live failed.
    #[error("document lifecycle read failed: {0:#}")]
    Lifecycle(anyhow::Error),
}

/// File documents for Fusion items, written as Macro AI for the user, as the
/// agent's other document writes are.
#[derive(Clone)]
pub struct FusionCadDocuments {
    creator: documents::inbound::toolset::DefaultDocumentToolCreator<ToolDocumentService>,
    documents: Arc<ToolDocumentService>,
    access: Arc<ToolEntityAccessService>,
}

impl CadDocuments for FusionCadDocuments {
    type Err = FusionDocumentsError;

    #[tracing::instrument(name = "fusion.create_document", skip_all, fields(document_id = %document_id, bytes = bytes.len()), err)]
    async fn create(
        &self,
        user: &MacroUserIdStr<'static>,
        document_id: Uuid,
        name: &str,
        file_type: FileType,
        bytes: Bytes,
    ) -> Result<CreatedCad, FusionDocumentsError> {
        let created = self
            .creator
            .create_file(
                &ToolEntityCreator::creation_principal(user),
                NewDocumentMetadata::builder(name).id(document_id).build(),
                NonMarkdownFileType::new(file_type)?,
                Vec::from(bytes),
            )
            .await;
        match created {
            Ok(created) => Ok(CreatedCad::Created {
                document_version_id: created.document_version_id(),
            }),
            // A document already holds this id: the import checks liveness
            // first, so it is one an earlier attempt made and the user
            // trashed. The import reports it gone.
            Err(DocumentError::Conflict(_)) => Ok(CreatedCad::AlreadyExists),
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(name = "fusion.add_version", skip_all, fields(document_id = %document_id, bytes = bytes.len()), err)]
    async fn add_version(
        &self,
        user: &MacroUserIdStr<'static>,
        document_id: Uuid,
        bytes: Bytes,
    ) -> Result<AddedVersion, FusionDocumentsError> {
        let receipt = self
            .access
            .generate_entity_access_receipt::<EditAccessLevel>(
                user,
                None,
                &document_id.to_string(),
                model_entity::EntityType::Document,
            )
            .await
            .map_err(FusionDocumentsError::Access)?;
        let added = self
            .creator
            .add_file_version(receipt, Vec::from(bytes))
            .await?;
        Ok(AddedVersion {
            document_version_id: added.document_version_id,
            created: added.created,
        })
    }

    async fn is_live(&self, document_id: Uuid) -> Result<bool, FusionDocumentsError> {
        self.documents
            .document_is_live(document_id)
            .await
            .map_err(FusionDocumentsError::Lifecycle)
    }
}

/// Whether `composed` can connect the app the import reads through.
fn serves_autodesk(composed: &connectors::composition::Composed) -> bool {
    connectors::ConnectorId::parse(fusion_import::outbound::aps::AUTODESK_APP)
        .is_ok_and(|app| composed.serves_native_api_app(&app))
}

/// Compose `ImportFromFusion`. It is unwired (every call fails with a clear
/// error) on a host whose connectors can't connect Autodesk, or when the
/// download client can't be built. Who may use it follows each user's `enable-fusion-import` flag: on
/// for everyone on a local stack and off on a host without a flag client.
pub fn build_fusion_tool_context(
    pool: sqlx::PgPool,
    connectors: Option<&connectors::composition::Composed>,
    document_tool_context: &ToolDocumentToolContext,
    environment: macro_env::Environment,
    flags: Option<feature_flags::outbound::posthog::PostHogFeatureFlags>,
) -> ToolFusionToolContext {
    // Only a composition that signs in to Autodesk can hold the connection
    // the import reads through; elsewhere (document storage's channel bot)
    // the tool answers that it is not available here, never "not connected".
    let Some(composed) = connectors.filter(|composed| serves_autodesk(composed)) else {
        return ToolFusionToolContext::unwired();
    };
    let downloads = match HttpSignedDownloads::new() {
        Ok(downloads) => downloads,
        Err(error) => {
            tracing::error!(error = ?error, "failed to build the Fusion download client; ImportFromFusion is off");
            return ToolFusionToolContext::unwired();
        }
    };
    let rollout = match (environment, flags) {
        (macro_env::Environment::Local, _) => FusionImportRollout::Everyone,
        (_, Some(flags)) => FusionImportRollout::Flagged(flags),
        (_, None) => FusionImportRollout::Nobody,
    };
    let documents = FusionCadDocuments {
        creator: document_tool_context.creator.clone(),
        documents: document_tool_context.service.clone(),
        access: document_tool_context.entity_access_service.clone(),
    };
    ToolFusionToolContext::wired(Arc::new(FusionImportService::new(
        ConnectedAps::new(Arc::new(composed.connectors.clone())),
        downloads,
        PgFusionRepo::new(pool),
        documents,
        rollout,
    )))
}
