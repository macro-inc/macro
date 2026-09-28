//! Handlers for CRM comment threads, served from the shared message store.
//!
//! CRM discussions live in `comms_messages` with `crm_company` / `crm_contact`
//! parents; these routes keep the legacy request and response shapes for
//! clients that still use them (see [`adapter`]). List/create routes use
//! [`EntityPermissionExtractor`] over the path's `crm_company`/`crm_contact`
//! entity type. Edit/delete are keyed by `comment_id` only and use
//! [`CrmCommentAccessLevelExtractor`], which resolves the comment's parent
//! before checking access. In every case the team-membership rule applies,
//! so members can't reach hidden parents.

mod adapter;

use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, RequiredPermission, TeamRole, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::EntityPermissionExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Deserialize;
use serde_json::Value;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    domain::{
        auth::CrmCommentReceipt,
        comment::{CrmComment, CrmCommentEntityType, CrmCommentThread, DeleteCrmCommentResult},
        model::CrmError,
        service::CrmService,
    },
    inbound::axum_extractors::CrmCommentAccessLevelExtractor,
};

pub use adapter::CrmCommentAdapter;

use super::CrmRouterState;

/// Request body for `POST /crm/comments/{entity_type}/{entity_id}`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCrmCommentRequest {
    /// Existing thread to append to. Omit to start a new thread on the
    /// addressed entity.
    pub thread_id: Option<Uuid>,
    /// Ignored: discussions keep no thread metadata.
    pub thread_metadata: Option<Value>,
    /// The comment body (markdown).
    pub text: String,
    /// Ignored: messages keep no client metadata.
    pub metadata: Option<Value>,
}

/// Request body for `PATCH /crm/comments/comment/{comment_id}`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EditCrmCommentRequest {
    /// The new comment body (markdown).
    pub text: String,
}

/// List the comment threads on a CRM company or contact. Access is
/// enforced by [`EntityPermissionExtractor`] against the path's
/// `crm_company`/`crm_contact` entity type — hidden parents are
/// invisible to plain members. An accessible entity with no threads
/// returns `200 []`.
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
pub async fn list_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: EntityPermissionExtractor<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path((entity_type, entity_id)): Path<(CrmCommentEntityType, Uuid)>,
) -> Result<Json<Vec<CrmCommentThread>>, CrmError> {
    let view = message_receipt(&access.entity_access_receipt, CrmError::ThreadNotFound)?;
    let threads = CrmCommentAdapter::new(state.messages.as_ref())
        .list(view, entity_type, entity_id)
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
pub async fn create_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: EntityPermissionExtractor<Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path((entity_type, entity_id)): Path<(CrmCommentEntityType, Uuid)>,
    Json(req): Json<CreateCrmCommentRequest>,
) -> Result<Json<CrmCommentThread>, CrmError> {
    let text = req.text.trim();
    if text.is_empty() {
        return Err(CrmError::InvalidRequest(
            "comment text cannot be empty".into(),
        ));
    }
    let view = message_receipt(&access.entity_access_receipt, CrmError::ThreadNotFound)?;
    let write = message_receipt(&access.entity_access_receipt, CrmError::ThreadNotFound)?;
    let adapter = CrmCommentAdapter::new(state.messages.as_ref());
    let root = match req.thread_id {
        None => None,
        Some(thread_id) => {
            Some(resolve_root(&state, &access, &adapter, view.clone(), thread_id).await?)
        }
    };
    let thread = adapter
        .create(write, view, entity_type, entity_id, root, text)
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
pub async fn edit_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmCommentAccessLevelExtractor<ViewAccessLevel, C, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(comment_id): Path<Uuid>,
    Json(req): Json<EditCrmCommentRequest>,
) -> Result<Json<CrmComment>, CrmError> {
    let text = req.text.trim();
    if text.is_empty() {
        return Err(CrmError::InvalidRequest(
            "comment text cannot be empty".into(),
        ));
    }
    let write = message_receipt(access.receipt.receipt(), CrmError::CommentNotFound)?;
    let comment = CrmCommentAdapter::new(state.messages.as_ref())
        .edit(write, comment_id, text)
        .await?;
    Ok(Json(comment))
}

/// Delete a CRM comment, scoped to the requesting user's team. Deleting a
/// thread's first comment deletes the whole discussion, as on documents
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
pub async fn delete_handler<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: CrmCommentAccessLevelExtractor<ViewAccessLevel, C, Eas, Auth>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(comment_id): Path<Uuid>,
) -> Result<Json<DeleteCrmCommentResult>, CrmError> {
    let write = message_receipt(access.receipt.receipt(), CrmError::CommentNotFound)?;
    let result = CrmCommentAdapter::new(state.messages.as_ref())
        .delete(write, comment_id)
        .await?;
    Ok(Json(result))
}

/// Narrow a verified CRM receipt to the message capability a store call
/// needs. A caller who can see the record but not comment on it gets
/// `missing`, a 404, so the routes do not reveal what exists.
fn message_receipt<P: RequiredPermission, T: RequiredPermission + Clone>(
    receipt: &EntityAccessReceipt<T>,
    missing: CrmError,
) -> Result<EntityAccessReceipt<P>, CrmError> {
    receipt.clone().try_into_requirement().map_err(|_| missing)
}

/// The discussion root a client's `threadId` names: a root message id, or a
/// legacy `crm_thread` id that clients loaded before the import still hold.
async fn resolve_root<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    state: &CrmRouterState<C, St, Eas, Auth>,
    access: &EntityPermissionExtractor<Eas, Auth>,
    adapter: &CrmCommentAdapter<'_>,
    view: EntityAccessReceipt<messages::domain::service::MessageView>,
    thread_id: Uuid,
) -> Result<Uuid, CrmError> {
    if adapter.is_root(view, thread_id).await? {
        return Ok(thread_id);
    }
    let (team_id, team_role) = owning_team_for_entity(state, access).await?;
    let legacy = CrmCommentReceipt::new(access.entity_access_receipt.clone(), team_id, team_role)?;
    state
        .service
        .legacy_thread_root(&legacy, &thread_id)
        .await?
        .ok_or(CrmError::ThreadNotFound)
}

/// Resolve the owning team of the entity the comment hangs off — and the
/// caller's role on it — derived from the same ownership lookup that grants
/// access, not the caller's default team, so the bundled team can't drift
/// from the authorized entity. `EntityPermissionExtractor` already validated
/// access on that entity, so a failure here means corrupted state rather
/// than a real authorization miss.
async fn owning_team_for_entity<
    C: CrmService,
    St,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    state: &CrmRouterState<C, St, Eas, Auth>,
    access: &EntityPermissionExtractor<Eas, Auth>,
) -> Result<(Uuid, TeamRole), CrmError> {
    let user_id = access
        .entity_access_receipt
        .get_authenticated_user()
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
    let entity = access.entity_access_receipt.entity();
    let (_permission, team_id, team_role) = state
        .entity_access_service
        .get_crm_entity_permission_with_team(
            Some(&user_id.0),
            &entity.entity_id,
            entity.entity_type,
        )
        .await
        .map_err(|e| CrmError::StorageLayerError(anyhow::Error::msg(e.to_string())))?;
    Ok((team_id, team_role))
}
