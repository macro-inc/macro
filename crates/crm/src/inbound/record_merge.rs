//! HTTP routes for merging duplicate records: review a merge, then commit it
//! with the review's revision. Mount at `/crm`. Every handler is a thin
//! adapter over [`RecordMerges`], which checks the caller's role and the
//! rollout flag.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::domain::{
    auth::CrmTeamReceipt,
    model::CrmError,
    record_merge::{
        MergeBlock, MergeCommand, MergeError, MergeOutcome, MergePreview, MergeRecordType,
        MergeTargets, SharingRulesChoice, service::RecordMerges,
    },
};

/// Services the merge routes run through.
pub struct MergeRouterState<Merges, Eas, Auth> {
    /// The merge use case.
    pub merges: Arc<Merges>,
    /// Resolves the caller's team role.
    pub entity_access: Arc<Eas>,
    /// Authentication state.
    pub authorization: MacroAuthorizationState<Auth>,
}

impl<Merges, Eas, Auth> Clone for MergeRouterState<Merges, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            merges: self.merges.clone(),
            entity_access: self.entity_access.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Merges, Eas, Auth> FromRef<MergeRouterState<Merges, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &MergeRouterState<Merges, Eas, Auth>) -> Self {
        state.entity_access.clone()
    }
}

impl<Merges, Eas, Auth> FromRef<MergeRouterState<Merges, Eas, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &MergeRouterState<Merges, Eas, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Mount at `/crm`.
pub fn router<Merges, Eas, Auth, S>(state: MergeRouterState<Merges, Eas, Auth>) -> Router<S>
where
    Merges: RecordMerges,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/merges/preview", post(preview::<Merges, Eas, Auth>))
        .route("/merges", post(commit::<Merges, Eas, Auth>))
        .with_state(state)
}

/// The records a merge names.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergePreviewRequest {
    /// The kind of record merged.
    pub record_type: MergeRecordType,
    /// The record that stays.
    pub survivor_id: Uuid,
    /// The records merged into it, at most ten.
    #[schema(min_items = 1, max_items = 10)]
    pub source_ids: Vec<Uuid>,
}

/// A reviewed merge to commit.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeCommitRequest {
    /// The kind of record merged.
    pub record_type: MergeRecordType,
    /// The record that stays.
    pub survivor_id: Uuid,
    /// The records merged into it.
    #[schema(min_items = 1, max_items = 10)]
    pub source_ids: Vec<Uuid>,
    /// The revision of the review being confirmed.
    pub revision: String,
    /// A new key per merge, reused only to retry the same one: a retry
    /// returns the first result.
    pub request_key: Uuid,
    /// What happens to teammates' email sharing that names a record merged
    /// away; keeps sharing it when left out.
    #[serde(default)]
    pub sharing_rules: SharingRulesChoice,
}

/// Why a merge was refused.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MergeErrorResponse {
    /// A stable code: `merge_permission_required`, `merge_unavailable`,
    /// `record_unavailable`, `record_hidden`, `record_already_merged`,
    /// `merge_preview_stale`, `merge_request_reused`, `merge_conflict`,
    /// `merge_sharing_rules_too_large`, `invalid_request`.
    pub code: String,
    /// What happened, for people.
    pub message: String,
    /// The record a `record_hidden` or `record_already_merged` refusal is about.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_id: Option<Uuid>,
    /// For `record_already_merged`, the record it opens now.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_id: Option<Uuid>,
    /// For `merge_conflict`, what blocks the merge.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<MergeBlock>,
}

impl IntoResponse for MergeError {
    fn into_response(self) -> Response {
        if let MergeError::Crm(error) = self {
            return match error {
                CrmError::AccessDenied | CrmError::CrmDisabledForTeam | CrmError::Contended => {
                    error.into_response()
                }
                other => {
                    tracing::error!(error = ?other, "merge failed");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(MergeErrorResponse {
                            code: "storage_error".into(),
                            message: "the merge failed; nothing was changed".into(),
                            record_id: None,
                            current_id: None,
                            blocked: None,
                        }),
                    )
                        .into_response()
                }
            };
        }
        let status = match &self {
            MergeError::PermissionRequired | MergeError::Unavailable => StatusCode::FORBIDDEN,
            MergeError::RecordUnavailable => StatusCode::NOT_FOUND,
            MergeError::Invalid(_) => StatusCode::BAD_REQUEST,
            _ => StatusCode::CONFLICT,
        };
        let (record_id, current_id) = match &self {
            MergeError::RecordHidden(id) => (Some(*id), None),
            MergeError::AlreadyMerged {
                record_id,
                current_id,
            } => (Some(*record_id), Some(*current_id)),
            _ => (None, None),
        };
        let blocked = match &self {
            MergeError::Conflict(block) => Some(block.clone()),
            _ => None,
        };
        (
            status,
            Json(MergeErrorResponse {
                code: self.code().into(),
                message: self.to_string(),
                record_id,
                current_id,
                blocked,
            }),
        )
            .into_response()
    }
}

fn receipt(
    access: MacroUserTeamExtractorV2<
        MemberTeamRole,
        impl EntityAccessService,
        impl MacroAuthorizationService,
    >,
) -> Result<CrmTeamReceipt<MemberTeamRole>, MergeError> {
    Ok(CrmTeamReceipt::from_team_receipt(
        access.entity_access_receipt,
    )?)
}

/// Review a merge: what moves to the record that stays, the values that
/// differ, what happens to email sync and teammates' sharing, and anything
/// that blocks it. Read-only. Admins and owners only, while merging is
/// enabled for them.
#[utoipa::path(
    post,
    path = "/crm/merges/preview",
    operation_id = "preview_crm_merge",
    request_body = MergePreviewRequest,
    responses(
        (status = 200, body = MergePreview),
        (status = 400, body = MergeErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = MergeErrorResponse),
        (status = 404, body = MergeErrorResponse),
        (status = 409, body = MergeErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn preview<
    Merges: RecordMerges,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<MergeRouterState<Merges, Eas, Auth>>,
    Json(request): Json<MergePreviewRequest>,
) -> Result<Json<MergePreview>, MergeError> {
    let targets = MergeTargets::new(request.record_type, request.survivor_id, request.source_ids)?;
    Ok(Json(
        state.merges.preview(&receipt(access)?, &targets).await?,
    ))
}

/// Merge records into the one that stays, as reviewed. It can't be undone.
/// The records merged away are deleted; their ids keep opening the record
/// that stays. Refused with `merge_preview_stale` when anything the review
/// showed has changed.
#[utoipa::path(
    post,
    path = "/crm/merges",
    operation_id = "commit_crm_merge",
    request_body = MergeCommitRequest,
    responses(
        (status = 200, body = MergeOutcome),
        (status = 400, body = MergeErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 403, body = MergeErrorResponse),
        (status = 404, body = MergeErrorResponse),
        (status = 409, body = MergeErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn commit<
    Merges: RecordMerges,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    access: MacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
    State(state): State<MergeRouterState<Merges, Eas, Auth>>,
    Json(request): Json<MergeCommitRequest>,
) -> Result<Json<MergeOutcome>, MergeError> {
    let command = MergeCommand {
        targets: MergeTargets::new(request.record_type, request.survivor_id, request.source_ids)?,
        revision: request.revision,
        request_key: request.request_key,
        sharing_rules: request.sharing_rules,
    };
    Ok(Json(
        state.merges.commit(&receipt(access)?, &command).await?,
    ))
}
