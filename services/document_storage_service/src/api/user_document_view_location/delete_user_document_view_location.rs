use crate::api::context::ApiContext;
use crate::api::context::EntityAccessService;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::MacroAuthorizationExtractor;
use model::response::{EmptyResponse, GenericErrorResponse, GenericResponse};
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
#[tracing::instrument(skip(ctx, authorization, _document), fields(user_id=?authorization.user_context.user_id))]
pub async fn handler(
    _document: DocumentAccessExtractor<ViewAccessLevel, EntityAccessService>,
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    match macro_db_client::user_document_view_location::delete::delete_user_document_view_location(
        &ctx.db,
        &authorization.user_context.user_id,
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
