//! Handlers for CRM comment threads.
//!
//! Threads and comments hang off a CRM company or contact and mirror the
//! document comment shape so the frontend reuses its thread assembly /
//! rendering. All routes are team-scoped via [`MacroUserTeamExtractor`];
//! entity ownership is enforced in the repository.

use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::{
    domain::{
        models::{MemberTeamRole, TeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    comment::{CrmComment, CrmCommentEntityType, CrmCommentThread, DeleteCrmCommentResult},
    model::CrmError,
    service::CrmService,
};

use super::CrmRouterState;

/// Request body for `POST /crm/comments/{entity_type}/{entity_id}`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCrmCommentRequest {
    /// Existing thread to append to. Omit to start a new thread on the
    /// addressed entity.
    pub thread_id: Option<Uuid>,
    /// Metadata to set on a newly created thread (ignored when replying
    /// without a value).
    pub thread_metadata: Option<Value>,
    /// The comment body (markdown).
    pub text: String,
    /// Arbitrary client metadata for the comment.
    pub metadata: Option<Value>,
}

/// Request body for `PATCH /crm/comments/comment/{comment_id}`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditCrmCommentRequest {
    /// The new comment body (markdown).
    pub text: String,
}

/// List the comment threads on a CRM company or contact, scoped to the
/// requesting user's team. Returns 404 when the entity isn't owned by the
/// team; an owned entity with no threads returns `200 []`.
#[utoipa::path(
    get,
    path = "/crm/comments/{entity_type}/{entity_id}",
    operation_id = "list_crm_comments",
    params(
        ("entity_type" = CrmCommentEntityType, Path, description = "Which CRM entity kind the threads hang off"),
        ("entity_id" = Uuid, Path, description = "The CRM company or contact id"),
    ),
    responses(
        (status = 200, body = [CrmCommentThread]),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(entity_id = %entity_id))]
pub async fn list_handler<C: CrmService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path((entity_type, entity_id)): Path<(CrmCommentEntityType, Uuid)>,
) -> Result<Json<Vec<CrmCommentThread>>, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;
    let include_hidden = access
        .entity_access_receipt
        .entity_permission()
        .allows_team_role(TeamRole::Admin);

    let threads = state
        .service
        .get_crm_comment_threads(&team_id, entity_type, &entity_id, include_hidden)
        .await?;

    Ok(Json(threads))
}

/// Create a comment on a CRM company or contact — a new thread, or a reply
/// when `threadId` is supplied. Returns the full thread (with all comments)
/// after the insert. Team-scoped; 404 when the entity isn't owned by the
/// team or `threadId` doesn't belong to it.
#[utoipa::path(
    post,
    path = "/crm/comments/{entity_type}/{entity_id}",
    operation_id = "create_crm_comment",
    params(
        ("entity_type" = CrmCommentEntityType, Path, description = "Which CRM entity kind the thread hangs off"),
        ("entity_id" = Uuid, Path, description = "The CRM company or contact id"),
    ),
    request_body = CreateCrmCommentRequest,
    responses(
        (status = 200, body = CrmCommentThread),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(entity_id = %entity_id))]
pub async fn create_handler<C: CrmService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path((entity_type, entity_id)): Path<(CrmCommentEntityType, Uuid)>,
    Json(req): Json<CreateCrmCommentRequest>,
) -> Result<Json<CrmCommentThread>, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;
    let include_hidden = access
        .entity_access_receipt
        .entity_permission()
        .allows_team_role(TeamRole::Admin);
    let owner = access
        .entity_access_receipt
        .get_authenticated_user()
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

    let text = req.text.trim();
    if text.is_empty() {
        return Err(CrmError::InvalidRequest(
            "comment text cannot be empty".into(),
        ));
    }

    let thread = state
        .service
        .create_crm_comment(
            &team_id,
            entity_type,
            &entity_id,
            owner.as_ref(),
            req.thread_id,
            req.thread_metadata,
            text,
            req.metadata,
            include_hidden,
        )
        .await?;

    Ok(Json(thread))
}

/// Edit a CRM comment's text, scoped to the requesting user's team via the
/// comment's thread → entity → company. Returns the updated comment.
#[utoipa::path(
    patch,
    path = "/crm/comment/{comment_id}",
    operation_id = "edit_crm_comment",
    params(
        ("comment_id" = Uuid, Path, description = "The CRM comment to edit"),
    ),
    request_body = EditCrmCommentRequest,
    responses(
        (status = 200, body = CrmComment),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(comment_id = %comment_id))]
pub async fn edit_handler<C: CrmService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(comment_id): Path<Uuid>,
    Json(req): Json<EditCrmCommentRequest>,
) -> Result<Json<CrmComment>, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;
    let include_hidden = access
        .entity_access_receipt
        .entity_permission()
        .allows_team_role(TeamRole::Admin);

    let text = req.text.trim();
    if text.is_empty() {
        return Err(CrmError::InvalidRequest(
            "comment text cannot be empty".into(),
        ));
    }

    let comment = state
        .service
        .edit_crm_comment(&team_id, &comment_id, text, include_hidden)
        .await?;

    Ok(Json(comment))
}

/// Soft-delete a CRM comment, scoped to the requesting user's team. When it
/// was the thread's last live comment, the thread is soft-deleted too
/// (reported via `threadDeleted`).
#[utoipa::path(
    delete,
    path = "/crm/comment/{comment_id}",
    operation_id = "delete_crm_comment",
    params(
        ("comment_id" = Uuid, Path, description = "The CRM comment to delete"),
    ),
    responses(
        (status = 200, body = DeleteCrmCommentResult),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(comment_id = %comment_id))]
pub async fn delete_handler<C: CrmService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<CrmRouterState<C, Eas>>,
    Path(comment_id): Path<Uuid>,
) -> Result<Json<DeleteCrmCommentResult>, CrmError> {
    let team_id = macro_uuid::string_to_uuid(&access.entity_access_receipt.entity().entity_id)
        .map_err(|_| CrmError::InvalidTeamId)?;
    let include_hidden = access
        .entity_access_receipt
        .entity_permission()
        .allows_team_role(TeamRole::Admin);

    let result = state
        .service
        .delete_crm_comment(&team_id, &comment_id, include_hidden)
        .await?;

    Ok(Json(result))
}
