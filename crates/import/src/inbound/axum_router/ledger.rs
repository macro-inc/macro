//! Routes over the import ledger and the single Notion page import.

use super::error_response;
use crate::domain::models::{ImportEntity, ImportSource, ImportStatus, Initiator};
use crate::domain::service::{
    DiscardOutcome, ImportNotionPageOutcome, ImportStager, NotionPageImporter, StageOutcome,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

/// Filters for listing the ledger.
#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListImportEntitiesQuery {
    /// Only rows from this source.
    pub source: Option<ImportSource>,
    /// Only rows in this status.
    pub status: Option<ImportStatus>,
}

/// List the user's import ledger, newest first: their own rows plus items
/// teammates imported into the team.
#[utoipa::path(
    get,
    path = "/import/entities",
    params(ListImportEntitiesQuery),
    responses(
        (status = 200, body = Vec<ImportEntity>),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn list_entities_handler<T: ImportStager, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Query(query): Query<ListImportEntitiesQuery>,
) -> Response {
    match service
        .list_entities(
            &user.authorization.user.macro_user_id,
            query.source,
            query.status,
        )
        .await
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) => error_response(error),
    }
}

/// Body for tracking an external item in the ledger.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TrackImportEntityRequest {
    /// The external system the item comes from.
    pub source: ImportSource,
    /// Stable id of the item in its source: a Linear identifier such as
    /// `ENG-142`, a Notion page URL or id, or a Slack channel id.
    pub foreign_id: String,
    /// What the item is. Linear: `{identifier, title, description?, status?,
    /// priority?, assignee?, assignee_email?, url?}`. Notion: `{title, url?,
    /// summary?}`, never page content. Slack: `{name, channel_id?, purpose?,
    /// participants?}`.
    pub metadata: serde_json::Value,
    /// The Macro entity already created from the item, which records it as
    /// imported. Without one the item is staged as a candidate.
    #[serde(default)]
    pub entity_id: Option<String>,
}

/// What became of a ledger request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ImportOutcome {
    /// The item is staged as a candidate the user has not accepted yet.
    Staged,
    /// The item is now imported as `entity`.
    Imported,
    /// The user already imported the item; do not create a duplicate.
    AlreadyImported,
    /// A teammate already imported the item into the team; do not create a
    /// duplicate.
    AlreadyImportedByTeammate,
    /// The user declined the item before; it was left alone.
    PreviouslyDeclined,
    /// An import is already copying the item in.
    ImportInProgress,
}

/// A ledger row and what the request did to it.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ImportEntityOutcome {
    /// What happened.
    pub outcome: ImportOutcome,
    /// The row backing the outcome; carries the Macro entity once imported.
    pub entity: ImportEntity,
}

/// Track an external item: stage it as a candidate before creating
/// anything, or, with `entityId`, record a Macro entity already created from
/// it. Deduplicates against the user's rows and the team's imports.
#[utoipa::path(
    post,
    path = "/import/entities",
    request_body = TrackImportEntityRequest,
    responses(
        (status = 200, body = ImportEntityOutcome),
        (status = 400, description = "Blank foreign id or entity id"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user, body), fields(user_id = %user.authorization.user.macro_user_id, source = body.source.as_ref(), foreign_id = %body.foreign_id))]
pub async fn track_entity_handler<T: ImportStager, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<TrackImportEntityRequest>,
) -> Response {
    let user = user.authorization.user.macro_user_id;
    let foreign_id = body.foreign_id.trim();
    if foreign_id.is_empty() {
        return (StatusCode::BAD_REQUEST, "foreignId is required").into_response();
    }

    let Some(entity_id) = body.entity_id.as_deref() else {
        return match service
            .stage(
                &user,
                Initiator::Chat,
                body.source,
                foreign_id,
                body.metadata,
            )
            .await
        {
            Ok(outcome) => Json(stage_outcome(outcome)).into_response(),
            Err(error) => error_response(error),
        };
    };

    let entity_id = entity_id.trim();
    if entity_id.is_empty() {
        return (StatusCode::BAD_REQUEST, "entityId must not be blank").into_response();
    }
    match service
        .record_imported(
            &user,
            Initiator::Chat,
            body.source,
            foreign_id,
            body.metadata,
            entity_id,
        )
        .await
    {
        Ok(entity) => Json(ImportEntityOutcome {
            outcome: ImportOutcome::Imported,
            entity,
        })
        .into_response(),
        Err(error) => error_response(error),
    }
}

fn stage_outcome(outcome: StageOutcome) -> ImportEntityOutcome {
    match outcome {
        StageOutcome::Staged(entity) => ImportEntityOutcome {
            outcome: ImportOutcome::Staged,
            entity,
        },
        StageOutcome::AlreadyImported {
            entity,
            by_teammate,
        } => ImportEntityOutcome {
            outcome: if by_teammate {
                ImportOutcome::AlreadyImportedByTeammate
            } else {
                ImportOutcome::AlreadyImported
            },
            entity,
        },
        StageOutcome::PreviouslyDiscarded(entity) => ImportEntityOutcome {
            outcome: ImportOutcome::PreviouslyDeclined,
            entity,
        },
        StageOutcome::ImportInProgress(entity) => ImportEntityOutcome {
            outcome: ImportOutcome::ImportInProgress,
            entity,
        },
    }
}

/// Decline one of the user's staged candidates; it is remembered as
/// declined and not proposed again.
#[utoipa::path(
    delete,
    path = "/import/entities/{id}",
    params(("id" = Uuid, Path, description = "Ledger row id")),
    responses(
        (status = 204, description = "Declined"),
        (status = 404, description = "No such row belongs to the user"),
        (status = 409, description = "Only staged rows can be declined"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn discard_entity_handler<T: ImportStager, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Response {
    match service
        .discard_entity(&user.authorization.user.macro_user_id, id)
        .await
    {
        Ok(DiscardOutcome::Discarded) => StatusCode::NO_CONTENT.into_response(),
        Ok(DiscardOutcome::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Ok(DiscardOutcome::NotDiscardable(status)) => (
            StatusCode::CONFLICT,
            format!(
                "the item is {}; only staged items can be declined",
                status.as_ref()
            ),
        )
            .into_response(),
        Err(error) => error_response(error),
    }
}

/// Body for importing one Notion page.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ImportNotionPageRequest {
    /// The Notion page URL or 32-character page id.
    pub page_url: String,
}

/// Import one Notion page as a Macro document through the user's Notion
/// connection, deduplicated against the ledger. Databases and pages that
/// are mostly a database are not imported.
#[utoipa::path(
    post,
    path = "/import/notion/pages",
    request_body = ImportNotionPageRequest,
    responses(
        (status = 200, body = ImportEntityOutcome),
        (status = 400, description = "Blank page URL"),
        (status = 409, body = super::ImportErrorBody, description = "Notion is not connected"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user, body), fields(user_id = %user.authorization.user.macro_user_id, page_url = %body.page_url))]
pub async fn import_notion_page_handler<T: NotionPageImporter, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<ImportNotionPageRequest>,
) -> Response {
    let page_url = body.page_url.trim();
    if page_url.is_empty() {
        return (StatusCode::BAD_REQUEST, "pageUrl is required").into_response();
    }

    let outcome = match service
        .import_notion_page(&user.authorization.user.macro_user_id, page_url)
        .await
    {
        Ok(outcome) => outcome,
        Err(error) => return error_response(error),
    };
    Json(match outcome {
        ImportNotionPageOutcome::Imported {
            entity,
            already_existed,
            by_teammate,
        } => ImportEntityOutcome {
            outcome: match (already_existed, by_teammate) {
                (_, true) => ImportOutcome::AlreadyImportedByTeammate,
                (true, false) => ImportOutcome::AlreadyImported,
                (false, false) => ImportOutcome::Imported,
            },
            entity,
        },
        ImportNotionPageOutcome::PreviouslyDiscarded(entity) => ImportEntityOutcome {
            outcome: ImportOutcome::PreviouslyDeclined,
            entity,
        },
        ImportNotionPageOutcome::ImportInProgress(entity) => ImportEntityOutcome {
            outcome: ImportOutcome::ImportInProgress,
            entity,
        },
    })
    .into_response()
}
