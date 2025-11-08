use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json, extract};
use macro_db_client::share_permission::edit::edit_thread_permission;
use macro_middleware::cloud_storage::ensure_access::project::ProjectBodyAccessLevelExtractor;
use macro_middleware::cloud_storage::ensure_access::thread::ThreadAccessLevelExtractor;
use macro_share_permissions::user_item_access::update_user_item_access;
use model::response::{
    ErrorResponse, GenericErrorResponse, GenericSuccessResponse, SuccessResponse,
};
use model::thread::EmailThreadPermission;
use model::thread::request::PatchThreadRequestV2;
use model::user::UserContext;
use models_permissions::share_permission::access_level::{
    AccessLevel, EditAccessLevel, OwnerAccessLevel,
};

#[derive(serde::Deserialize)]
pub struct ThreadParams {
    pub thread_id: String,
}

/// Edits the share permissions of a thread.
#[utoipa::path(
    tag = "threads",
    patch,
    operation_id="edit_thread_v2",
    path = "/v2/threads/{thread_id}",
    params(
            ("thread_id" = String, Path, description = "thread ID")
    ),
    request_body = PatchThreadRequestV2,
    responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, project), fields(user_id=?user_context.user_id))]
pub async fn edit_thread_handler(
    ThreadAccessLevelExtractor { access_level, .. }: ThreadAccessLevelExtractor<OwnerAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    thread_context: Extension<EmailThreadPermission>,
    extract::Path(ThreadParams { thread_id }): extract::Path<ThreadParams>,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, PatchThreadRequestV2>,
) -> Result<Response, Response> {
    let req = project.into_inner();

    if req.project_id.is_some() && access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permissions to move this item",
            }),
        )
            .into_response());
    }

    if req.share_permission.is_some() && access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permission to modify share permissions",
            }),
        )
            .into_response());
    }

    if let Some(share_permission) = req.share_permission {
        let mut tx = ctx.db.begin().await.map_err(|e| {
            tracing::error!(error=?e, "unable to edit thread");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to edit thread",
                }),
            )
                .into_response()
        })?;

        edit_thread_permission(
            &mut tx,
            &share_permission,
            &thread_context.share_permission_id,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to update thread share permissions");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update thread share permissions",
                }),
            )
                .into_response()
        })?;

        update_user_item_access(
            &mut tx,
            &ctx.comms_service_client,
            &user_context.user_id,
            &thread_id,
            "thread",
            &share_permission,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to update user item access");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to update user item access",
                }),
            )
                .into_response()
        })?;

        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "unable to edit thread");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to edit thread",
                }),
            )
                .into_response()
        })?;
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
