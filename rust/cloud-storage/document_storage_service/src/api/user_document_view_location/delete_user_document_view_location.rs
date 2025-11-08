use crate::api::context::ApiContext;
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::response::{EmptyResponse, GenericErrorResponse, GenericResponse};
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;

#[derive(serde::Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Deletes a document location for the user
#[utoipa::path(
    operation_id = "delete_user_document_view_location",
    delete,
    path = "/user_document_view_location/{document_id}",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body=EmptyResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    document: DocumentAccessExtractor<ViewAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    match macro_db_client::user_document_view_location::delete::delete_user_document_view_location(
        &ctx.db,
        &user_context.user_id,
        &document_id,
    )
    .await
    {
        Ok(_) => (StatusCode::OK, Json(EmptyResponse::default())).into_response(),
        Err(e) => {
            tracing::error!(error=?e, "unable to delete user pdf document location");
            GenericResponse::builder()
                .message("unable to delete user pdf document location")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
