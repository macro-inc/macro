use crate::api::context::ApiContext;
use crate::api::context::{AuthorizationService, EntityAccessService};
use axum::Json;
use axum::extract::State;
use axum::response::Response;
use axum::{extract::Path, http::StatusCode, response::IntoResponse};
use documents_hex::domain::purge::DocumentPurgeService as _;
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::{
    ErrorResponse, GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: uuid::Uuid,
}

/// Permanently deletes a document.
#[utoipa::path(
        tag = "document",
        delete,
        operation_id = "permanently_delete_document",
        path = "/documents/{document_id}/permanent",
        params(
            ("document_id" = String, Path, description = "Document ID")
        ),
        responses(
            (status = 200, body=SuccessResponse),
            (status = 401, body=GenericErrorResponse),
            (status = 404, body=GenericErrorResponse),
            (status = 500, body=GenericErrorResponse),
        )
    )]
#[tracing::instrument(skip(state, user, _access), fields(user_id=?user.authorization.user.macro_user_id))]
pub async fn permanently_delete_document_handler(
    _access: DocumentAccessExtractor<OwnerAccessLevel, EntityAccessService, AuthorizationService>,
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(Params { document_id }): Path<Params>,
) -> Result<Response, Response> {
    tracing::info!("permanently_delete_document");

    state
        .document_purger
        .purge(document_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to permanently delete document");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to permanently delete document".into(),
                }),
            )
                .into_response()
        })?;

    let response_data = GenericSuccessResponse { success: true };

    Ok(GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK))
}
