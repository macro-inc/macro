use crate::api::context::ApiContext;
use crate::model::response::documents::user_document_view_location::UserDocumentViewLocationResponse;
use axum::{
    Extension,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use macro_middleware::cloud_storage::ensure_access::document::DocumentAccessExtractor;
use model::response::{GenericErrorResponse, GenericResponse};
use model::user::UserContext;
use models_permissions::share_permission::access_level::ViewAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Gets a UserPdfDocumentLocation entry
#[utoipa::path(
    get,
    operation_id = "get_user_document_view_location",
    path = "/user_document_view_location/{document_id}",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body=UserDocumentViewLocationResponse),
        (status = 401, body=GenericResponse),
        (status = 404, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=?user_context.user_id))]
pub async fn handler(
    access: DocumentAccessExtractor<ViewAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    match macro_db_client::user_document_view_location::get::get_user_document_view_location(
        &ctx.db,
        &user_context.user_id,
        &document_id,
    )
    .await
    {
        Ok(location) => (
            StatusCode::OK,
            Json(UserDocumentViewLocationResponse {
                location: location.map(|location| location.location),
            }),
        )
            .into_response(),
        Err(e) => {
            tracing::error!(error=?e, "unable to get user document view location");
            GenericResponse::builder()
                .message("unable to get user document view location")
                .is_error(true)
                .send(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
