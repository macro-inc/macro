use crate::api::context::ApiContext;
use crate::model::response::documents::get::GetDocumentUserAccessLevelResponse;
use axum::Json;
use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use model::response::{GenericErrorResponse, GenericResponse};
use model::user::UserContext;
use models_permissions::share_permission::access_level::AccessLevel;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets the user's access level to the document
#[utoipa::path(
        tag = "document",
        get,
        path = "/documents/{document_id}/access_level",
        operation_id = "get_document_access_level",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=GetDocumentUserAccessLevelResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    let user_access_level: Option<AccessLevel> =
        match macro_middleware::cloud_storage::ensure_access::get_users_access_level_v2(
            &ctx.db,
            &ctx.comms_service_client,
            &user_context.user_id,
            &document_id,
            "document",
        )
        .await
        {
            Ok(user_access_level) => user_access_level,
            Err(e) => {
                tracing::error!(error=?e, "failed to get user access level");
                return GenericResponse::builder()
                    .message("failed to get user access level")
                    .is_error(true)
                    .send(StatusCode::INTERNAL_SERVER_ERROR);
            }
        };

    let user_access_level = if let Some(user_access_level) = user_access_level {
        user_access_level
    } else {
        tracing::warn!("user does not have access to document");
        return GenericResponse::builder()
            .message("user does not have access to document")
            .is_error(true)
            .send(StatusCode::UNAUTHORIZED);
    };

    (
        StatusCode::OK,
        Json(GetDocumentUserAccessLevelResponse { user_access_level }),
    )
        .into_response()
}
