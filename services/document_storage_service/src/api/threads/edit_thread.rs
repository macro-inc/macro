use crate::api::context::ApiContext;
use crate::api::context::{AuthorizationService, EntityAccessService};
use crate::service::thread_share::ThreadShareError;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Json, extract};
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractorV2;
use entity_access::inbound::axum_extractors::ThreadAccessLevelExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{
    ErrorResponse, GenericErrorResponse, GenericSuccessResponse, SuccessResponse,
};
use models_permissions::share_permission::access_level::{EditAccessLevel, OwnerAccessLevel};
use models_permissions::share_permission::team_share::TeamSharePolicyError;

fn thread_share_response(error: ThreadShareError) -> Response {
    let status = match &error {
        ThreadShareError::NotFound => StatusCode::NOT_FOUND,
        ThreadShareError::Policy(
            TeamSharePolicyError::MissingActor | TeamSharePolicyError::NotOwner,
        ) => StatusCode::FORBIDDEN,
        ThreadShareError::Policy(TeamSharePolicyError::InvalidRevision)
        | ThreadShareError::Conflict => StatusCode::CONFLICT,
        ThreadShareError::Policy(_) | ThreadShareError::InvalidInput => StatusCode::BAD_REQUEST,
        ThreadShareError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
        tracing::error!(error=?error, "unable to update thread share permissions");
        "unable to update thread share permissions".to_owned()
    } else {
        error.to_string()
    };
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}

#[derive(serde::Deserialize)]
pub struct ThreadParams {
    pub thread_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchThreadRequestV2 {
    /// The new project that the thread will belong to.
    pub project_id: Option<String>,
    /// The share permissions for the thread.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}

/// Edits the share permissions of a thread.
#[utoipa::path(
    tag = "threads",
    patch,
    operation_id="edit_thread_v2",
    path = "/threads/{thread_id}",
    params(
            ("thread_id" = String, Path, description = "thread ID")
    ),
    request_body = PatchThreadRequestV2,
    responses(
            (status = 200, body=SuccessResponse),
            (status = 400, body=GenericErrorResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 403, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 409, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user, project, thread_access), fields(user_id=?user.authorization.user.macro_user_id), err(Debug))]
pub async fn edit_thread_handler(
    thread_access: ThreadAccessLevelExtractor<
        OwnerAccessLevel,
        EntityAccessService,
        AuthorizationService,
    >,
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    extract::Path(ThreadParams { thread_id }): extract::Path<ThreadParams>,
    project: ProjectBodyAccessLevelExtractorV2<
        EditAccessLevel,
        PatchThreadRequestV2,
        EntityAccessService,
        AuthorizationService,
    >,
) -> Result<Response, Response> {
    let req = project.into_inner();

    if let Some(share_permission) = req.share_permission {
        ctx.thread_share_service
            .update_share_policy(thread_access.entity_access_receipt, share_permission)
            .await
            .map_err(thread_share_response)?;
    }

    Ok((
        StatusCode::OK,
        Json(SuccessResponse {
            error: false,
            data: GenericSuccessResponse::default(),
        }),
    )
        .into_response())
}
