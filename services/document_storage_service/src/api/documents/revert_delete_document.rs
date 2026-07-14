use crate::api::context::EntityAccessService;
use axum::extract::State;
use axum::{Extension, extract::Path, http::StatusCode, response::IntoResponse};
use entity_access::inbound::axum_extractors::DocumentAccessExtractor;
#[allow(unused_imports)]
use futures::stream::TryStreamExt;
use model::document::DocumentBasic;
use model::response::{
    GenericErrorResponse, GenericResponse, GenericSuccessResponse, SuccessResponse,
};
use model::user::UserContext;
use models_permissions::share_permission::access_level::OwnerAccessLevel;
use serde::Deserialize;
use sqlx::PgPool;

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
#[tracing::instrument(skip(db, user_context, document_context, _access), fields(user_id=?user_context.user_id))]
pub async fn handler(
    _access: DocumentAccessExtractor<OwnerAccessLevel, EntityAccessService>,
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    document_context: Extension<DocumentBasic>,
    Path(Params { document_id }): Path<Params>,
) -> impl IntoResponse {
    tracing::info!("revert_delete document");

    if let Err(e) = macro_db_client::document::revert_delete::revert_delete_document(
        &db,
        &document_id,
        document_context.project_id.as_deref(),
    )
    .await
    {
        tracing::error!(error=?e, document_id=?document_id, "unable to revert document");
        return GenericResponse::builder()
            .message("unable to revert document")
            .is_error(true)
            .send(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let response_data = GenericSuccessResponse { success: true };

    GenericResponse::builder()
        .data(&response_data)
        .send(StatusCode::OK)
}
