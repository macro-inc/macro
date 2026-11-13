//! The import ledger over HTTP: the same operations the `CreateImportEntity`,
//! `ListImportEntities`, `DeleteImportEntity` and `ImportNotionPage` tools drive,
//! for the SDK.

use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::domain::models::{ImportEntity, ImportSource, ImportStatus, Initiator};
use crate::domain::ports::ImportError;
use crate::domain::service::{
    DiscardOutcome, ImportNotionPageOutcome, ImportStager, NotionPageImporter, StageOutcome,
};

/// Filters for listing the ledger.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListImportEntitiesQuery {
    /// Only rows from this source.
    pub source: Option<ImportSource>,
    /// Only rows in this status.
    pub status: Option<ImportStatus>,
}

/// The caller's ledger rows.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportEntitiesResponse {
    /// The caller's own rows and their team's imported rows, newest first.
    pub entities: Vec<ImportEntity>,
}

/// Whether a tracked item is a candidate or an import already made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TrackImportStatus {
    /// A candidate the user has not accepted yet.
    Staged,
    /// A Macro entity already created from the item.
    Imported,
}

/// Body for tracking one external item in the ledger.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrackImportEntityRequest {
    /// The external system the item comes from.
    pub source: ImportSource,
    /// Stable id of the item in its source: a Linear identifier such as
    /// `ENG-142`, a Notion page URL or id, or a Slack channel id.
    pub foreign_id: String,
    /// `staged` to propose the item, `imported` to record an entity already
    /// created from it.
    pub status: TrackImportStatus,
    /// Per-source metadata. Linear: `{identifier, title, …}`; Notion:
    /// `{title, url?, summary?}`; Slack: `{name, …}`.
    #[schema(value_type = Object)]
    pub metadata: serde_json::Value,
    /// The Macro entity created from the item; required when `status` is
    /// `imported`.
    pub entity_id: Option<String>,
}

/// What tracking an item did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TrackImportOutcome {
    /// The item is staged.
    Staged,
    /// The created entity is recorded as imported.
    RecordedImported,
    /// The caller already imported the item; do not create a duplicate.
    AlreadyImported,
    /// A teammate already imported the item into the team.
    AlreadyImportedByTeammate,
    /// The caller declined the item before; it was not staged again.
    PreviouslyDeclined,
    /// An import of the item is running.
    ImportInProgress,
}

/// The outcome of tracking an item, with its ledger row.
#[derive(Debug, Serialize, ToSchema)]
pub struct TrackImportEntityResponse {
    /// What happened.
    pub outcome: TrackImportOutcome,
    /// The row behind the outcome.
    pub entity: ImportEntity,
}

/// Body for importing one Notion page.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportNotionPageRequest {
    /// The Notion page URL or 32-character page id.
    pub page: String,
}

/// What importing one Notion page did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportNotionPageResult {
    /// The page is now a Macro document.
    Imported,
    /// The caller already imported the page.
    AlreadyImported,
    /// A teammate already imported the page.
    AlreadyImportedByTeammate,
    /// The caller declined the page before, so it was not imported.
    PreviouslyDeclined,
    /// An import of the page is running.
    ImportInProgress,
}

/// The outcome of importing a Notion page, with its ledger row.
#[derive(Debug, Serialize, ToSchema)]
pub struct ImportNotionPageResponse {
    /// What happened.
    pub outcome: ImportNotionPageResult,
    /// The row behind the outcome; `entity_id` is the document once imported.
    pub entity: ImportEntity,
}

/// List the caller's import ledger: staged candidates, running and finished
/// imports (with the team's imports), and declined items.
#[utoipa::path(
    get,
    path = "/import/entities",
    operation_id = "list_import_entities",
    params(ListImportEntitiesQuery),
    responses(
        (status = 200, body = ImportEntitiesResponse),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn list_entities_handler<T: ImportStager, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<ListImportEntitiesQuery>,
) -> Result<Json<ImportEntitiesResponse>, LedgerError> {
    let entities = service
        .list_entities(
            &user.authorization.user.macro_user_id,
            query.source,
            query.status,
        )
        .await?;
    Ok(Json(ImportEntitiesResponse { entities }))
}

/// Track an external item in the ledger: stage it as a candidate, or record a
/// Macro entity already created from it. Says when the item was already
/// imported, so callers do not create a duplicate.
#[utoipa::path(
    post,
    path = "/import/entities",
    operation_id = "track_import_entity",
    request_body = TrackImportEntityRequest,
    responses(
        (status = 200, body = TrackImportEntityResponse),
        (status = 400, description = "Invalid item or metadata"),
        (status = 422, description = "The import service refused the item"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user, body), fields(user_id = %user.authorization.user.macro_user_id, source = body.source.as_ref()), err(Debug))]
pub async fn track_entity_handler<T: ImportStager, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<TrackImportEntityRequest>,
) -> Result<Json<TrackImportEntityResponse>, LedgerError> {
    let user = user.authorization.user.macro_user_id;
    let response = match body.status {
        TrackImportStatus::Staged => {
            let outcome = service
                .stage(
                    &user,
                    Initiator::Chat,
                    body.source,
                    &body.foreign_id,
                    body.metadata,
                )
                .await?;
            match outcome {
                StageOutcome::Staged(entity) => TrackImportEntityResponse {
                    outcome: TrackImportOutcome::Staged,
                    entity,
                },
                StageOutcome::AlreadyImported {
                    entity,
                    by_teammate,
                } => TrackImportEntityResponse {
                    outcome: if by_teammate {
                        TrackImportOutcome::AlreadyImportedByTeammate
                    } else {
                        TrackImportOutcome::AlreadyImported
                    },
                    entity,
                },
                StageOutcome::PreviouslyDiscarded(entity) => TrackImportEntityResponse {
                    outcome: TrackImportOutcome::PreviouslyDeclined,
                    entity,
                },
                StageOutcome::ImportInProgress(entity) => TrackImportEntityResponse {
                    outcome: TrackImportOutcome::ImportInProgress,
                    entity,
                },
            }
        }
        TrackImportStatus::Imported => {
            let Some(entity_id) = body
                .entity_id
                .as_deref()
                .map(str::trim)
                .filter(|id| !id.is_empty())
            else {
                return Err(LedgerError::Invalid(
                    "entityId is required when status is imported",
                ));
            };
            let entity = service
                .record_imported(
                    &user,
                    Initiator::Chat,
                    body.source,
                    &body.foreign_id,
                    body.metadata,
                    entity_id,
                )
                .await?;
            // An earlier mapping wins; say so rather than claiming this entity was recorded.
            let outcome = if entity.entity_id.as_deref() == Some(entity_id) {
                TrackImportOutcome::RecordedImported
            } else if entity.user_id != user.as_ref() {
                TrackImportOutcome::AlreadyImportedByTeammate
            } else {
                TrackImportOutcome::AlreadyImported
            };
            TrackImportEntityResponse { outcome, entity }
        }
    };
    Ok(Json(response))
}

/// Decline one of the caller's staged candidates; it is remembered as declined
/// and not proposed again.
#[utoipa::path(
    delete,
    path = "/import/entities/{id}",
    operation_id = "decline_import_entity",
    params(("id" = Uuid, Path, description = "Ledger row id")),
    responses(
        (status = 204, description = "Declined"),
        (status = 404, description = "No such row belongs to the caller"),
        (status = 409, description = "Only staged rows can be declined"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn decline_entity_handler<T: ImportStager, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, LedgerError> {
    match service
        .discard_entity(&user.authorization.user.macro_user_id, id)
        .await?
    {
        DiscardOutcome::Discarded => Ok(StatusCode::NO_CONTENT),
        DiscardOutcome::NotFound => Err(LedgerError::NotFound),
        DiscardOutcome::NotDiscardable(_) => Err(LedgerError::NotStaged),
    }
}

/// Import one Notion page as a Macro document through the caller's Notion
/// connection, deduplicated against the ledger. Notion databases are not
/// imported; a whole workspace goes through a reviewed import instead.
#[utoipa::path(
    post,
    path = "/import/notion/pages",
    operation_id = "import_notion_page",
    request_body = ImportNotionPageRequest,
    responses(
        (status = 200, body = ImportNotionPageResponse),
        (status = 400, description = "No page given"),
        (status = 422, description = "Not a page that can be imported, or Notion is not connected"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user, body), fields(user_id = %user.authorization.user.macro_user_id), err(Debug))]
pub async fn import_notion_page_handler<T: NotionPageImporter, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<ImportNotionPageRequest>,
) -> Result<Json<ImportNotionPageResponse>, LedgerError> {
    let page = body.page.trim();
    if page.is_empty() {
        return Err(LedgerError::Invalid("a Notion page URL or id is required"));
    }
    let response = match service
        .import_notion_page(&user.authorization.user.macro_user_id, page)
        .await?
    {
        ImportNotionPageOutcome::Imported {
            entity,
            already_existed,
            by_teammate,
        } => ImportNotionPageResponse {
            outcome: match (already_existed, by_teammate) {
                (_, true) => ImportNotionPageResult::AlreadyImportedByTeammate,
                (true, false) => ImportNotionPageResult::AlreadyImported,
                (false, false) => ImportNotionPageResult::Imported,
            },
            entity,
        },
        ImportNotionPageOutcome::PreviouslyDiscarded(entity) => ImportNotionPageResponse {
            outcome: ImportNotionPageResult::PreviouslyDeclined,
            entity,
        },
        ImportNotionPageOutcome::ImportInProgress(entity) => ImportNotionPageResponse {
            outcome: ImportNotionPageResult::ImportInProgress,
            entity,
        },
    };
    Ok(Json(response))
}

/// Why a ledger request failed.
#[derive(Debug, thiserror::Error)]
pub enum LedgerError {
    /// The request itself is invalid.
    #[error("{0}")]
    Invalid(&'static str),
    /// No such row belongs to the caller.
    #[error("no such import entity")]
    NotFound,
    /// Only staged rows can be declined.
    #[error("only staged import entities can be declined")]
    NotStaged,
    /// The import service refused or failed.
    #[error(transparent)]
    Import(#[from] ImportError),
}

impl IntoResponse for LedgerError {
    fn into_response(self) -> Response {
        match self {
            Self::Invalid(_) => (StatusCode::BAD_REQUEST, self.to_string()).into_response(),
            Self::NotFound => (StatusCode::NOT_FOUND, self.to_string()).into_response(),
            Self::NotStaged => (StatusCode::CONFLICT, self.to_string()).into_response(),
            Self::Import(ImportError::Admission(error)) => error.into_response(),
            Self::Import(error @ ImportError::Metadata(_)) => {
                (StatusCode::BAD_REQUEST, error.to_string()).into_response()
            }
            Self::Import(error @ ImportError::EntityNotAccessible(_)) => {
                (StatusCode::FORBIDDEN, error.to_string()).into_response()
            }
            Self::Import(error @ ImportError::ImportRunning) => {
                (StatusCode::CONFLICT, error.to_string()).into_response()
            }
            Self::Import(error @ ImportError::NotionNotConnected) => {
                (StatusCode::CONFLICT, error.to_string()).into_response()
            }
            // The tools hand these messages to the model; keep them for SDK callers too.
            Self::Import(error @ ImportError::Other(_)) => {
                (StatusCode::UNPROCESSABLE_ENTITY, error.to_string()).into_response()
            }
            Self::Import(error) => {
                tracing::error!(error = ?error, "import ledger request failed");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        }
    }
}
