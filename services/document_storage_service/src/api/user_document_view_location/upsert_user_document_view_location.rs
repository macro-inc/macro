use crate::api::context::ApiContext;
use crate::api::context::{AuthorizationService, EntityAccessService};
use crate::model::request::documents::user_document_view_location::UpsertUserDocumentViewLocationRequest;
use axum::{
    extract::{self, Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{EmptyResponse, GenericErrorResponse, GenericResponse};
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
#[tracing::instrument(skip(ctx, user, req, _access), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn handler(
    _access: DocumentAccessExtractor<ViewAccessLevel, EntityAccessService, AuthorizationService>,
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(Params { document_id }): Path<Params>,
    extract::Json(req): extract::Json<UpsertUserDocumentViewLocationRequest>,
) -> impl IntoResponse {
    if let Err(e) =
        macro_db_client::user_document_view_location::upsert::upsert_user_document_view_location(
            &ctx.db,
            user.authorization.user.macro_user_id.as_ref(),
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
