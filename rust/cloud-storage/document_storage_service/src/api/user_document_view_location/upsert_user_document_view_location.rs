use crate::api::context::ApiContext;
use crate::model::request::documents::user_document_view_location::UpsertUserDocumentViewLocationRequest;
use axum::extract::{Path, State};
use axum::{
    Extension, extract,
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

#[utoipa::path(
    post,
    operation_id="upsert_user_document_view_location",
    path = "/user_document_view_location/{document_id}",
    params(
        ("document_id" = String, Path, description = "Document ID")
    ),
    responses(
        (status = 200, body=EmptyResponse),
        (status = 400, body=GenericErrorResponse),
        (status = 401, body=GenericErrorResponse),
        (status = 500, body=GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context, req), fields(user_id=?user_context.user_id))]
pub async fn handler(
    access: DocumentAccessExtractor<ViewAccessLevel>,
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(Params { document_id }): Path<Params>,
    extract::Json(req): extract::Json<UpsertUserDocumentViewLocationRequest>,
) -> impl IntoResponse {
    if let Err(e) =
        macro_db_client::user_document_view_location::upsert::upsert_user_document_view_location(
            &ctx.db,
            &user_context.user_id,
            &document_id,
            &req.location,
        )
        .await
    {
        tracing::error!(error=?e, "unable to upsert user document view location");
        return GenericResponse::builder()
            .message("unable to upsert user document view location")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    (StatusCode::OK, Json(EmptyResponse::default())).into_response()
}
