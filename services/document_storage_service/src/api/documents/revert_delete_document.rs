use crate::api::context::{ApiContext, AuthorizationService, EntityAccessService};
use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use documents_hex::domain::{models::DocumentError, restore::restore_document};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
#[allow(unused_imports)]
use futures::stream::TryStreamExt;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::document::DocumentBasic;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Params {
    pub document_id: String,
}

/// Deletes a specific document
#[utoipa::path(
        tag = "document",
        put,
        operation_id = "revert_delete_document",
        path = "/documents/{document_id}/revert_delete",
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
#[tracing::instrument(skip_all, fields(document_id = %document_id))]
pub async fn handler(
    access: DocumentAccessExtractor<OwnerAccessLevel, EntityAccessService, AuthorizationService>,
    State(state): State<ApiContext>,
    _user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    tracing::info!("revert_delete document");

    let result = restore_document(
        access.entity_access_receipt,
        &document_context.0,
        move |id, project| async move {
            macro_db_client::document::revert_delete::revert_delete_document(
                &state.db,
                &id,
                project.as_deref(),
            )
            .await
        },
    )
    .await;
    if let Err(error) = result {
        let status = if matches!(
            &error,
            DocumentError::Forbidden(_) | DocumentError::Unauthorized
        ) {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        if status == StatusCode::FORBIDDEN {
            tracing::warn!(?error, "document restoration refused");
        } else {
            tracing::error!(?error, "unable to revert document");
        }
        return GenericResponse::builder()
            .message("unable to revert document")
            .is_error(true)
            .send(status);
    }

    let response_data = GenericSuccessResponse { success: true };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
