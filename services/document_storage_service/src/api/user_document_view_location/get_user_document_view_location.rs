use crate::api::context::ApiContext;
use crate::api::context::{AuthorizationService, EntityAccessService};
use crate::model::response::documents::user_document_view_location::UserDocumentViewLocationResponse;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{GenericErrorResponse, GenericResponse};
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
#[tracing::instrument(skip(ctx, user, _access), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn handler(
    _access: DocumentAccessExtractor<ViewAccessLevel, EntityAccessService, AuthorizationService>,
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    match macro_db_client::user_document_view_location::get::get_user_document_view_location(
        &ctx.db,
        user.authorization.user.macro_user_id.as_ref(),
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
