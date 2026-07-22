//! AI tools over the import ledger.
//!
//! One tool surface serves three callers, differing only in the
//! [`ToolPolicy`] baked into the context:
//! - chat sessions get all three tools, staging as `initiator = chat`;
//! - gather jobs get only `CreateImportEntity`, locked to one source and
//!   `initiator = onboarding`, staging only;
//! - Notion import jobs get only `FinalizeImport`.
//!
//! The policy lives server-side in the tool context — the model can never
//! spoof another user, source, or initiator.

use crate::domain::models::{ImportEntity, ImportSource, ImportStatus, Initiator, metadata_label};
use crate::domain::ports::ImportError;
use crate::domain::service::{DiscardOutcome, ImportFinalizer, ImportStager, StageOutcome};
use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolCallError, ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// What a given toolset instance is allowed to do; baked in server-side.
#[derive(Debug, Clone, Copy)]
pub struct ToolPolicy {
    /// The initiator recorded on rows staged through this context.
    pub initiator: Initiator,
    /// When set, staging is locked to this source (gather jobs).
    pub forced_source: Option<ImportSource>,
    /// Whether `status = imported` writes are allowed (chat agents that
    /// already created the entity).
    pub allow_imported: bool,
}

impl ToolPolicy {
    /// Policy for interactive chat sessions.
    pub fn chat() -> Self {
        Self {
            initiator: Initiator::Chat,
            forced_source: None,
            allow_imported: true,
        }
    }

    /// Policy for an onboarding gather job over one connector.
    pub fn gather(source: ImportSource) -> Self {
        Self {
            initiator: Initiator::Onboarding,
            forced_source: Some(source),
            allow_imported: false,
        }
    }

    /// Policy for a Notion import job (only `FinalizeImport` is registered,
    /// which ignores staging policy).
    pub fn import_job() -> Self {
        Self {
            initiator: Initiator::Onboarding,
            forced_source: Some(ImportSource::Notion),
            allow_imported: false,
        }
    }
}

/// Service context for import AI tools.
///
/// The service is optional because the tool schemas ship with the shared
/// chat toolset while only hosts that can build the import service (DB,
/// MCP credentials, gateway) actually wire it. Where it is absent, calls
/// fail with a clear "not available here" error instead of not existing.
pub struct ImportToolContext<T> {
    /// The import service, where the host wired one.
    pub service: Option<Arc<T>>,
    /// What this toolset instance may do.
    pub policy: ToolPolicy,
}

impl<T> Clone for ImportToolContext<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            policy: self.policy,
        }
    }
}

impl<T> ImportToolContext<T> {
    /// A chat-policy context backed by a real import service.
    pub fn wired(service: Arc<T>) -> Self {
        Self {
            service: Some(service),
            policy: ToolPolicy::chat(),
        }
    }

    /// A chat-policy context with no import service: every tool call fails
    /// with a clear error. For hosts that share the toolset but cannot
    /// build the service.
    pub fn unwired() -> Self {
        Self {
            service: None,
            policy: ToolPolicy::chat(),
        }
    }

    fn require_service(&self) -> ToolResult<&Arc<T>> {
        self.service.as_ref().ok_or_else(|| ToolCallError {
            description: "Import tracking is not available in this context.".to_string(),
            internal_error: anyhow::anyhow!("import service not wired into this host"),
        })
    }
}

/// The import toolset for interactive chat.
pub fn import_toolset<T: ImportStager>() -> AsyncToolCollection<ImportToolContext<T>> {
    AsyncToolCollection::new()
        .add_tool::<CreateImportEntity, ImportToolContext<T>>()
        .add_tool::<DeleteImportEntity, ImportToolContext<T>>()
        .add_tool::<ListImportEntities, ImportToolContext<T>>()
}

/// The staging-only toolset for gather jobs.
pub fn gather_toolset<T: ImportStager>() -> AsyncToolCollection<ImportToolContext<T>> {
    AsyncToolCollection::new().add_tool::<CreateImportEntity, ImportToolContext<T>>()
}

/// The finalize-only toolset for Notion import jobs.
pub fn notion_import_toolset<T: ImportFinalizer>() -> AsyncToolCollection<ImportToolContext<T>> {
    AsyncToolCollection::new().add_tool::<FinalizeImport, ImportToolContext<T>>()
}

fn tool_error(description: String, e: impl Into<anyhow::Error>) -> ToolCallError {
    ToolCallError {
        internal_error: e.into(),
        description,
    }
}

fn import_error(context: &str, e: ImportError) -> ToolCallError {
    ToolCallError {
        description: format!("{context}: {e}"),
        internal_error: e.into(),
    }
}

/// Compact row view returned by import tools.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntityView {
    /// Ledger row id (use with DeleteImportEntity).
    pub id: Uuid,
    /// The external system the item comes from.
    pub source: ImportSource,
    /// Stable id in the source system.
    pub foreign_id: String,
    /// Row status.
    pub status: ImportStatus,
    /// A human label from the metadata (title / channel name).
    pub label: String,
    /// The Macro entity it became, when imported.
    pub entity_id: Option<String>,
    /// The Macro entity type, when imported.
    pub entity_type: Option<String>,
    /// Whether the row belongs to a teammate (team-imported), not the user.
    pub imported_by_teammate: bool,
}

impl ImportEntityView {
    fn of(row: &ImportEntity, requesting_user: &str) -> Self {
        Self {
            id: row.id,
            source: row.source,
            foreign_id: row.foreign_id.clone(),
            status: row.status,
            label: metadata_label(row.source, &row.metadata),
            entity_id: row.entity_id.clone(),
            entity_type: row.entity_type.clone(),
            imported_by_teammate: row.user_id != requesting_user,
        }
    }
}

/// Status values accepted by [`CreateImportEntity`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CreateImportStatus {
    /// Track an item as a candidate the user has not accepted yet.
    Staged,
    /// Record an item you have ALREADY created a Macro entity for.
    Imported,
}

/// Track an external item in the import ledger.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "CreateImportEntity",
    description = "Track an external item (Linear issue, Notion page, Slack channel) in the import ledger. Use status `staged` to propose an item for import BEFORE creating anything; use status `imported` (with entityId) only to record a Macro entity you already created from the item. The response tells you when the item was already imported by the user or a teammate — in that case do NOT create a duplicate; point the user at the existing entity instead."
)]
pub struct CreateImportEntity {
    /// The external system the item comes from.
    #[schemars(description = "The external system the item comes from.")]
    pub source: ImportSource,

    /// Stable id of the item in the source system.
    #[schemars(
        description = "Stable id of the item in the source system: the Linear issue identifier (e.g. `ENG-142`), the Notion page URL or id, or the Slack channel id (e.g. `C0123456789`, falling back to the channel name)."
    )]
    pub foreign_id: String,

    /// Whether this is a staged candidate or an already-created import.
    #[schemars(
        description = "`staged` to propose the item for import; `imported` to record a Macro entity you already created from it (requires entityId)."
    )]
    pub status: CreateImportStatus,

    /// Per-source metadata describing the item.
    #[schemars(
        description = "Metadata describing the item. Linear: {identifier, title, description?, status?, priority?, assignee?, assignee_email?, url?}. Notion: {title, url?, summary?} — never include page content. Slack: {name, channel_id?, purpose?, participants?: [{name, email?}]}."
    )]
    pub metadata: serde_json::Value,

    /// The Macro entity id, when `status` is `imported`.
    #[schemars(
        description = "The id of the Macro entity you created, required when status is `imported`. The entity type is fixed by source: linear → task, notion → md (document), slack → channel."
    )]
    #[serde(default)]
    pub entity_id: Option<String>,
}

/// Response from tracking an item.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateImportEntityResponse {
    /// What happened: `staged`, `recorded_imported`, `already_imported`,
    /// `already_imported_by_teammate`, `previously_declined`, or
    /// `import_in_progress`.
    pub outcome: String,
    /// The ledger row backing the outcome.
    pub entity: ImportEntityView,
    /// What to do with this outcome.
    pub message: String,
}

#[async_trait]
impl<T: ImportStager> AsyncTool<ImportToolContext<T>> for CreateImportEntity {
    type Output = CreateImportEntityResponse;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id, source = self.source.as_ref(), foreign_id = %self.foreign_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ImportToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user = request_context.user_id.clone();
        let policy = service_context.policy;

        if let Some(forced) = policy.forced_source
            && self.source != forced
        {
            return Err(tool_error(
                format!(
                    "This session only stages {} items; got {}.",
                    forced.as_ref(),
                    self.source.as_ref()
                ),
                anyhow::anyhow!("forced-source policy violation"),
            ));
        }

        match self.status {
            CreateImportStatus::Staged => {
                let outcome = service_context
                    .require_service()?
                    .stage(
                        &user,
                        policy.initiator,
                        self.source,
                        &self.foreign_id,
                        self.metadata.clone(),
                    )
                    .await
                    .map_err(|e| import_error("Failed to stage item", e))?;
                Ok(stage_response(outcome, user.as_ref()))
            }
            CreateImportStatus::Imported => {
                if !policy.allow_imported {
                    return Err(tool_error(
                        "This session can only stage candidates (status `staged`); it cannot \
                         record imported entities."
                            .to_string(),
                        anyhow::anyhow!("imported-status policy violation"),
                    ));
                }
                let Some(entity_id) = self
                    .entity_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                else {
                    return Err(tool_error(
                        "entityId is required when status is `imported` — pass the id of the \
                         Macro entity you created."
                            .to_string(),
                        anyhow::anyhow!("missing entity_id"),
                    ));
                };
                let row = service_context
                    .require_service()?
                    .record_imported(
                        &user,
                        policy.initiator,
                        self.source,
                        &self.foreign_id,
                        self.metadata.clone(),
                        entity_id,
                    )
                    .await
                    .map_err(|e| import_error("Failed to record import", e))?;
                Ok(CreateImportEntityResponse {
                    outcome: "recorded_imported".into(),
                    message: format!(
                        "Recorded {} as imported.",
                        metadata_label(row.source, &row.metadata)
                    ),
                    entity: ImportEntityView::of(&row, user.as_ref()),
                })
            }
        }
    }
}

fn stage_response(outcome: StageOutcome, user: &str) -> CreateImportEntityResponse {
    match outcome {
        StageOutcome::Staged(row) => CreateImportEntityResponse {
            outcome: "staged".into(),
            message: format!(
                "Staged {} for import. It will be imported when the user accepts it.",
                metadata_label(row.source, &row.metadata)
            ),
            entity: ImportEntityView::of(&row, user),
        },
        StageOutcome::AlreadyImported {
            entity,
            by_teammate,
        } => CreateImportEntityResponse {
            outcome: if by_teammate {
                "already_imported_by_teammate".into()
            } else {
                "already_imported".into()
            },
            message: format!(
                "{} was already imported{} as {} `{}`. Do NOT create a duplicate — tell the \
                 user it already exists and reference the existing entity.",
                metadata_label(entity.source, &entity.metadata),
                if by_teammate {
                    " by a teammate into the team"
                } else {
                    ""
                },
                entity.entity_type.as_deref().unwrap_or("entity"),
                entity.entity_id.as_deref().unwrap_or("?"),
            ),
            entity: ImportEntityView::of(&entity, user),
        },
        StageOutcome::PreviouslyDiscarded(row) => CreateImportEntityResponse {
            outcome: "previously_declined".into(),
            message: format!(
                "The user previously declined {}; it was not re-staged. Skip it.",
                metadata_label(row.source, &row.metadata)
            ),
            entity: ImportEntityView::of(&row, user),
        },
        StageOutcome::ImportInProgress(row) => CreateImportEntityResponse {
            outcome: "import_in_progress".into(),
            message: "An import is already running for this item; leave it alone.".into(),
            entity: ImportEntityView::of(&row, user),
        },
    }
}

/// Decline a staged import candidate.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "DeleteImportEntity",
    description = "Decline a staged import candidate on the user's behalf. The item is remembered as declined so it won't be proposed again; only the user's own staged items can be declined."
)]
pub struct DeleteImportEntity {
    /// The ledger row id to decline.
    #[schemars(
        description = "The import entity id to decline (from CreateImportEntity or ListImportEntities)."
    )]
    pub id: Uuid,
}

/// Response from declining a candidate.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImportEntityResponse {
    /// Whether the row is now discarded.
    pub discarded: bool,
    /// What happened.
    pub message: String,
}

#[async_trait]
impl<T: ImportStager> AsyncTool<ImportToolContext<T>> for DeleteImportEntity {
    type Output = DeleteImportEntityResponse;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id, id = %self.id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ImportToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let outcome = service_context
            .require_service()?
            .discard_entity(&request_context.user_id.clone(), self.id)
            .await
            .map_err(|e| import_error("Failed to decline item", e))?;
        match outcome {
            DiscardOutcome::Discarded => Ok(DeleteImportEntityResponse {
                discarded: true,
                message: "Declined. It won't be proposed again.".into(),
            }),
            DiscardOutcome::NotFound => Err(tool_error(
                format!("No import entity `{}` belongs to this user.", self.id),
                anyhow::anyhow!("not found"),
            )),
            DiscardOutcome::NotDiscardable(status) => Err(tool_error(
                format!(
                    "Import entity `{}` is `{}`; only staged items can be declined.",
                    self.id,
                    status.as_ref()
                ),
                anyhow::anyhow!("not discardable"),
            )),
        }
    }
}

/// List import ledger rows.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ListImportEntities",
    description = "List the user's import ledger: staged candidates, in-flight imports, imported items (including ones teammates imported into the team), and declined items. Use this to check what already exists before proposing or creating imports."
)]
pub struct ListImportEntities {
    /// Filter to one source.
    #[schemars(description = "Filter to one source system.")]
    #[serde(default)]
    pub source: Option<ImportSource>,

    /// Filter to one status.
    #[schemars(
        description = "Filter to one status: staged, importing, imported, or discarded. Omit for all."
    )]
    #[serde(default)]
    pub status: Option<ImportStatus>,
}

/// Response from listing the ledger.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListImportEntitiesResponse {
    /// The visible rows, newest first.
    pub entities: Vec<ImportEntityView>,
}

#[async_trait]
impl<T: ImportStager> AsyncTool<ImportToolContext<T>> for ListImportEntities {
    type Output = ListImportEntitiesResponse;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ImportToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let user = request_context.user_id.clone();
        let rows = service_context
            .require_service()?
            .list_entities(&user, self.source, self.status)
            .await
            .map_err(|e| import_error("Failed to list import entities", e))?;
        Ok(ListImportEntitiesResponse {
            entities: rows
                .iter()
                .map(|row| ImportEntityView::of(row, user.as_ref()))
                .collect(),
        })
    }
}

/// Finalize one importing row as a Macro document.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "FinalizeImport",
    description = "Create the Macro document for one accepted import item and mark it imported. Call exactly once per item you were asked to import."
)]
pub struct FinalizeImport {
    /// The importing ledger row to finalize.
    #[schemars(description = "The import_id of the item, as listed in the instructions.")]
    pub import_id: Uuid,

    /// The document name.
    #[schemars(description = "The name for the created document (usually the item's title).")]
    pub name: String,

    /// The document body.
    #[schemars(description = "The full markdown body for the created document.")]
    pub content_markdown: String,
}

/// Response from finalizing an item.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeImportResponse {
    /// The Macro entity id that now exists.
    pub entity_id: String,
    /// The Macro entity type.
    pub entity_type: String,
}

#[async_trait]
impl<T: ImportFinalizer> AsyncTool<ImportToolContext<T>> for FinalizeImport {
    type Output = FinalizeImportResponse;

    #[tracing::instrument(skip_all, fields(user_id = %request_context.user_id, import_id = %self.import_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<ImportToolContext<T>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let row = service_context
            .require_service()?
            .finalize_document(
                &request_context.user_id.clone(),
                self.import_id,
                self.name.trim(),
                &self.content_markdown,
            )
            .await
            .map_err(|e| import_error("Failed to finalize import", e))?;
        Ok(FinalizeImportResponse {
            entity_id: row.entity_id.unwrap_or_default(),
            entity_type: row.entity_type.unwrap_or_default(),
        })
    }
}
