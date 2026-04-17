use crate::api::context::ApiContext;
use crate::api::context::EntityAccessService;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json, extract};
use entity_access::domain::models::EntityPermission;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractor;
use entity_access::inbound::axum_extractors::ThreadAccessLevelExtractor;
use macro_db_client::share_permission::edit::edit_thread_permission;
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
#[tracing::instrument(skip(ctx, user_context, project, thread_access), fields(user_id=?user_context.user_id))]
pub async fn edit_thread_handler(
    thread_access: ThreadAccessLevelExtractor<OwnerAccessLevel, EntityAccessService>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    thread_context: Extension<EmailThreadPermission>,
    extract::Path(ThreadParams { thread_id }): extract::Path<ThreadParams>,
    project: ProjectBodyAccessLevelExtractor<
        EditAccessLevel,
        PatchThreadRequestV2,
        EntityAccessService,
    >,
) -> Result<Response, Response> {
    let req = project.into_inner();

    let access_level = match thread_access.entity_access_receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
        _ => AccessLevel::Owner,
    };

    if req.project_id.is_some() && access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permissions to move this item".into(),
            }),
        )
            .into_response());
    }

    if req.share_permission.is_some() && access_level != AccessLevel::Owner {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse {
                message: "you do not have valid permission to modify share permissions".into(),
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
                    message: "unable to edit thread".into(),
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
                    message: "unable to update thread share permissions".into(),
                }),
            )
                .into_response()
        })?;

        update_user_item_access(
            &mut tx,
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
                    message: "unable to update user item access".into(),
                }),
            )
                .into_response()
        })?;

        tx.commit().await.map_err(|e| {
            tracing::error!(error=?e, "unable to edit thread");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to edit thread".into(),
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
